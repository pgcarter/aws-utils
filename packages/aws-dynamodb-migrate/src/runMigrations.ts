import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  computePending,
  discoverMigrations,
  findOutOfOrder,
  type DiscoveredMigration,
} from './discovery.js';
import { MigrationFailedError, OutOfOrderError } from './errors.js';
import {
  createLedgerClient,
  DEFAULT_ACTOR,
  LEDGER_PK,
  type LedgerActor,
} from './ledger.js';
import { acquireLock, createLockClient, releaseLock } from './lock.js';
import { noopLogger, type MigrationLogger } from './logger.js';

/**
 * The context a migration's `up` receives: the user's typed `@bm8/aws-dynamodb`
 * client, forwarded unchanged. A migration reads via indexed `pagedQuery` and
 * writes via per-item `update`s — never a `Scan`.
 */
export interface MigrationContext<TClient> {
  db: TClient;
}

/**
 * A migration module on disk. Exports a named, forward-only `up`.
 *
 * `up` MUST be idempotent: a failed run is retried from the top over
 * possibly-half-transformed items, so re-applying an item must be a no-op.
 */
export interface MigrationModule<TClient = unknown> {
  up: (ctx: MigrationContext<TClient>) => Promise<void>;
}

export interface RunMigrationsOptions<TClient> {
  /** The user's `createDynamoClient` instance, forwarded to each `up({ db })`. */
  client: TClient;
  /** The table the ledger lives in (the same table the migrations target). */
  tableName: string;
  /** Raw client carrying region/creds/endpoint, used to build the internal ledger client. */
  dynamoClient?: DynamoDBClient;
  /** Absolute path to the directory of migration modules. */
  migrationsDir: string;
  /** Actor recorded in ledger audit fields. Defaults to the tool's own identity. */
  actor?: LedgerActor;
  /**
   * Reject (with {@link OutOfOrderError}) a pending migration older than the
   * newest already-applied one, before applying anything. Defaults to `true`.
   * Set `false` (equivalently, {@link allowOutOfOrder}) to permit it.
   */
  strictOrder?: boolean;
  /**
   * Opt out of strict ordering: apply an out-of-order pending migration instead
   * of throwing. Defaults to `false`. For branchy teams that accept the risk.
   */
  allowOutOfOrder?: boolean;
  /**
   * Report which migrations *would* run, in order, but mutate nothing: no `up`
   * is executed, no ledger row is written, and the lock is never taken (so a dry
   * run cannot interfere with a real run in progress). The same blocking checks
   * still run, so a dry run faithfully reports whether the run would proceed.
   * Cannot simulate what each `up` would do to the data — only which migrations
   * are pending. Defaults to `false`.
   */
  dryRun?: boolean;
  /**
   * Progress sink. Receives which migrations are being applied, were applied, or
   * skipped, plus non-fatal warnings. Defaults to a silent no-op; the CLI passes
   * a console logger and a Lambda passes a structured one.
   */
  logger?: MigrationLogger;
}

/** Structured summary of a clean run. Never carries a failure — those throw. */
export interface MigrationSummary {
  /**
   * Ids applied this run, in ascending order. Under `dryRun`, the ids that
   * *would* be applied (nothing was actually written).
   */
  applied: string[];
  /** Ids already in the ledger and therefore skipped this run. */
  skipped: string[];
}

const checksumOf = (source: string): string =>
  createHash('sha256').update(source).digest('hex');

const importMigration = async <TClient>(filePath: string): Promise<MigrationModule<TClient>> => {
  const mod: unknown = await import(pathToFileURL(filePath).href);
  const up = (mod as { up?: unknown }).up;
  if (typeof up !== 'function') {
    throw new Error(`Migration ${filePath} does not export a named \`up\` function`);
  }
  return mod as MigrationModule<TClient>;
};

/**
 * Apply all pending migrations against a table, in ascending timestamp order.
 *
 * Discovers migration modules in `migrationsDir`, computes the pending set as
 * "on disk minus what the ledger already records", and runs each pending `up`
 * with the forwarded client. Every successful migration writes an `applied`
 * ledger row carrying its id, name and a checksum of its source bytes.
 * Already-applied migrations are skipped, so re-running is safe.
 */
export const runMigrations = async <TClient>(
  options: RunMigrationsOptions<TClient>,
): Promise<MigrationSummary> => {
  const {
    client,
    tableName,
    dynamoClient,
    migrationsDir,
    actor = DEFAULT_ACTOR,
    strictOrder = true,
    allowOutOfOrder = false,
    dryRun = false,
    logger = noopLogger,
  } = options;

  const ledger = createLedgerClient(tableName, dynamoClient, actor);

  const args: ApplyPendingArgs<TClient> = {
    ledger,
    client,
    migrationsDir,
    strictOrder,
    allowOutOfOrder,
    dryRun,
    logger,
  };

  // A dry run is read-only: it never takes the lock (so it cannot interfere with
  // a real run already in progress) and writes nothing. Skip the acquire/finally
  // dance entirely.
  if (dryRun) {
    return applyPending(args);
  }

  // Take the lock before doing anything else, so two concurrent runs cannot
  // double-apply. If another run holds it, acquireLock throws MigrationLockedError
  // here — before the try below — so we never release a lock we did not take.
  const lock = createLockClient(tableName, dynamoClient, actor);
  await acquireLock(lock, actor.id, new Date().toISOString());

  try {
    return await applyPending(args);
  } finally {
    // Released on every exit — clean run, failed migration, or out-of-order reject.
    await releaseLock(lock);
  }
};

interface ApplyPendingArgs<TClient> {
  ledger: ReturnType<typeof createLedgerClient>;
  client: TClient;
  migrationsDir: string;
  strictOrder: boolean;
  allowOutOfOrder: boolean;
  dryRun: boolean;
  logger: MigrationLogger;
}

const applyPending = async <TClient>({
  ledger,
  client,
  migrationsDir,
  strictOrder,
  allowOutOfOrder,
  dryRun,
  logger,
}: ApplyPendingArgs<TClient>): Promise<MigrationSummary> => {
  const entries = await readdir(migrationsDir);
  const discovered = discoverMigrations(entries);

  const ledgerRows = await ledger.ledger.pagedQuery({ pk: LEDGER_PK });

  // A prior `failed` row halts the whole line until a human repairs it: refuse
  // to apply anything (even unrelated newer migrations) while one stands. Report
  // the oldest offender, consistent with how out-of-order picks the oldest.
  const failedRows = ledgerRows
    .filter((row) => row.status === 'failed')
    .sort((a, b) => (a.SK < b.SK ? -1 : a.SK > b.SK ? 1 : 0));
  if (failedRows.length > 0) {
    const blocking = failedRows[0]!;
    throw new MigrationFailedError(
      { id: blocking.SK, name: blocking.name },
      blocking.error ?? 'a prior run left this migration in a failed state',
      [],
    );
  }

  const appliedIds = new Set(
    ledgerRows.filter((row) => row.status === 'applied').map((row) => row.SK),
  );

  const pending = computePending(discovered, appliedIds);
  const skippedMigrations = discovered.filter((m: DiscoveredMigration) => appliedIds.has(m.id));
  for (const m of skippedMigrations) {
    logger.info(`skipping already-applied migration ${m.name}`);
  }
  const skipped = skippedMigrations.map((m) => m.id);

  // Refuse an out-of-order merge before applying anything, unless the caller
  // has opted out via allowOutOfOrder (or strictOrder: false).
  if (strictOrder && !allowOutOfOrder) {
    const outOfOrder = findOutOfOrder(pending, appliedIds);
    if (outOfOrder) {
      throw new OutOfOrderError(outOfOrder.migration, outOfOrder.newestApplied);
    }
  }

  const applied: string[] = [];
  for (const migration of pending) {
    // A dry run reports the ordered would-run set but touches nothing — no file
    // read, no import, no `up`, no ledger write.
    if (dryRun) {
      logger.info(`[dry-run] would apply migration ${migration.name}`);
      applied.push(migration.id);
      continue;
    }

    const filePath = join(migrationsDir, migration.name);
    const checksum = checksumOf(await readFile(filePath, 'utf8'));

    logger.info(`applying migration ${migration.name}`);
    const { up } = await importMigration<TClient>(filePath);
    try {
      await up({ db: client });
    } catch (cause) {
      // No transactions: `up` may have left partial writes. Record a `failed`
      // row (which blocks every later run) and halt — do not run anything after.
      await ledger.ledger.put({
        PK: LEDGER_PK,
        SK: migration.id,
        name: migration.name,
        checksum,
        status: 'failed',
        error: cause instanceof Error ? cause.message : String(cause),
      });
      throw new MigrationFailedError(migration, cause, [...applied]);
    }

    await ledger.ledger.put({
      PK: LEDGER_PK,
      SK: migration.id,
      name: migration.name,
      checksum,
      status: 'applied',
    });
    logger.info(`applied migration ${migration.name}`);
    applied.push(migration.id);
  }

  return { applied, skipped };
};
