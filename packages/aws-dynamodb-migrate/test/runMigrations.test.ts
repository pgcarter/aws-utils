import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChecksumMismatchError,
  forceUnlock,
  MigrationFailedError,
  MigrationLockedError,
  OutOfOrderError,
  repair,
  runMigrations,
  status,
} from '../src';
import { type AppClient, makeUser, makeUserClient } from './fixtures';

const endpoint = process.env.DYNAMODB_TEST_ENDPOINT!;
const tableName = process.env.DYNAMODB_TEST_TABLE!;

const NOW = '2026-04-25T12:00:00.000Z';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/migrations',
);

// A separate fixture dir whose middle migration throws on purpose, used to
// exercise failure-halts-the-line and repair (retry/resolve).
const failingDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/failing-migrations',
);

const BACKFILL_ID = '20260101T0000';
const CAPITALIZE_ID = '20260102T0000';

const OK_ID = '20260301T0000';
const OK_NAME = '20260301T0000__ok.ts';
const BOOM_ID = '20260302T0000';
const BOOM_NAME = '20260302T0000__boom.ts';
const AFTER_ID = '20260303T0000';

let rawClient: DynamoDBClient;
let doc: DynamoDBDocumentClient;
let db: AppClient;

const readLedgerRow = async (id: string) => {
  const { Item } = await doc.send(
    new GetCommand({ TableName: tableName, Key: { PK: 'DB_MIGRATE', SK: id } }),
  );
  return Item;
};

/** Read the single lock row (PK=DB_MIGRATE, SK=LOCK), if present. */
const readLockRow = async () => {
  const { Item } = await doc.send(
    new GetCommand({ TableName: tableName, Key: { PK: 'DB_MIGRATE', SK: 'LOCK' } }),
  );
  return Item;
};

/** Seed a held lock directly, as if another run were in progress. */
const seedLock = async (actor: string) => {
  await doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'DB_MIGRATE',
        SK: 'LOCK',
        type: 'DB_MIGRATE_LOCK',
        actor,
        acquiredAt: NOW,
      },
    }),
  );
};

/** Drop every row in the DB_MIGRATE partition so each test starts from a clean ledger. */
const clearLedger = async () => {
  const { Items = [] } = await doc.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'DB_MIGRATE' },
    }),
  );
  for (const item of Items) {
    await doc.send(
      new DeleteCommand({ TableName: tableName, Key: { PK: item.PK, SK: item.SK } }),
    );
  }
};

/** Seed a ledger row directly, as if a prior run had applied this migration. */
const seedApplied = async (id: string, name: string) => {
  await doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'DB_MIGRATE',
        SK: id,
        type: 'DB_MIGRATE', // pagedQuery filters on this discriminator
        name,
        checksum: 'seeded',
        status: 'applied',
      },
    }),
  );
};

/** Seed a `failed` ledger row directly, as if a prior run had failed mid-line. */
const seedFailed = async (id: string, name: string, error: string) => {
  await doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'DB_MIGRATE',
        SK: id,
        type: 'DB_MIGRATE',
        name,
        checksum: 'seeded',
        status: 'failed',
        error,
      },
    }),
  );
};

beforeAll(() => {
  rawClient = new DynamoDBClient({
    endpoint,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  doc = DynamoDBDocumentClient.from(rawClient);
  db = makeUserClient(tableName, rawClient);
});

beforeEach(async () => {
  await clearLedger();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  rawClient.destroy();
});

describe('runMigrations', () => {
  it('applies pending migrations in order, records the ledger, and mutates data', async () => {
    await db.user.put(makeUser({ PK: 'USER#a', SK: 'USER#a', name: 'Ann' }));
    await db.user.put(makeUser({ PK: 'USER#b', SK: 'USER#b', name: 'Bob' }));

    const result = await runMigrations({
      client: db,
      tableName,
      dynamoClient: rawClient,
      migrationsDir,
    });

    // Applied in ascending timestamp order; nothing skipped on a first run.
    expect(result).toEqual({ applied: [BACKFILL_ID, CAPITALIZE_ID], skipped: [] });

    // Data was transformed: backfill set status, then capitalize upper-cased it.
    const ann = await db.user.get({ PK: 'USER#a', SK: 'USER#a' });
    const bob = await db.user.get({ PK: 'USER#b', SK: 'USER#b' });
    expect(ann?.status).toBe('ACTIVE');
    expect(bob?.status).toBe('ACTIVE');

    // A ledger row exists per applied migration with id, name, checksum, status.
    const backfillRow = await readLedgerRow(BACKFILL_ID);
    expect(backfillRow).toMatchObject({
      PK: 'DB_MIGRATE',
      SK: BACKFILL_ID,
      name: '20260101T0000__backfill-user-status.ts',
      status: 'applied',
    });
    expect(typeof backfillRow?.checksum).toBe('string');
    expect((backfillRow?.checksum as string).length).toBeGreaterThan(0);
  });

  it('skips already-applied migrations on a re-run and mutates nothing new', async () => {
    await db.user.put(makeUser({ PK: 'USER#c', SK: 'USER#c', name: 'Cara' }));

    await runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir });
    const afterFirst = await db.user.get({ PK: 'USER#c', SK: 'USER#c' });

    const result = await runMigrations({
      client: db,
      tableName,
      dynamoClient: rawClient,
      migrationsDir,
    });

    expect(result).toEqual({ applied: [], skipped: [BACKFILL_ID, CAPITALIZE_ID] });

    const afterSecond = await db.user.get({ PK: 'USER#c', SK: 'USER#c' });
    expect(afterSecond).toEqual(afterFirst);
  });

  it('keeps ledger rows out of users’ entity queries via the type discriminator', async () => {
    await db.user.put(makeUser({ PK: 'USER#d', SK: 'USER#d', name: 'Dee' }));
    await runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir });

    const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
    expect(users.every((u) => u.type === 'USER')).toBe(true);
  });

  describe('strict order', () => {
    const BACKFILL_NAME = '20260101T0000__backfill-user-status.ts';
    const CAPITALIZE_NAME = '20260102T0000__capitalize-status.ts';

    it('rejects a pending migration older than the newest applied, before applying anything', async () => {
      // Newer migration already applied, older one still pending — an out-of-order merge.
      await seedApplied(CAPITALIZE_ID, CAPITALIZE_NAME);

      const run = runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir });

      await expect(run).rejects.toBeInstanceOf(OutOfOrderError);
      await run.catch((error: OutOfOrderError) => {
        expect(error.migration.id).toBe(BACKFILL_ID);
        expect(error.newestApplied).toBe(CAPITALIZE_ID);
      });

      // Nothing was applied: the older migration left no ledger row.
      expect(await readLedgerRow(BACKFILL_ID)).toBeUndefined();
    });

    it('applies the out-of-order migration when allowOutOfOrder is set', async () => {
      await seedApplied(CAPITALIZE_ID, CAPITALIZE_NAME);

      const result = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        allowOutOfOrder: true,
      });

      expect(result.applied).toEqual([BACKFILL_ID]);
      expect(result.skipped).toContain(CAPITALIZE_ID);
      expect(await readLedgerRow(BACKFILL_ID)).toMatchObject({ status: 'applied' });
    });
  });

  describe('failure and repair', () => {
    const run = () =>
      runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir: failingDir });

    it('writes a failed row, halts the line, and rejects with MigrationFailedError', async () => {
      await db.user.put(makeUser({ PK: 'USER#f1', SK: 'USER#f1', name: 'Fay' }));

      const pending = run();
      await expect(pending).rejects.toBeInstanceOf(MigrationFailedError);
      await pending.catch((error: MigrationFailedError) => {
        expect(error.migration.id).toBe(BOOM_ID);
        expect(error.appliedBefore).toEqual([OK_ID]); // ok ran before boom threw
        expect(error.cause).toBeInstanceOf(Error);
        expect((error.cause as Error).message).toContain('boom');
      });

      // ok applied, boom recorded failed (with the cause), after never recorded.
      expect(await readLedgerRow(OK_ID)).toMatchObject({ status: 'applied' });
      expect(await readLedgerRow(BOOM_ID)).toMatchObject({
        status: 'failed',
        error: expect.stringContaining('boom'),
      });
      expect(await readLedgerRow(AFTER_ID)).toBeUndefined();

      // The migration after boom did not touch data.
      const fay = await db.user.get({ PK: 'USER#f1', SK: 'USER#f1' });
      expect(fay?.okMark).toBe('ok');
      expect(fay?.afterMark).toBeUndefined();
    });

    it('blocks a subsequent run while a failed row stands, applying nothing', async () => {
      await seedFailed(BOOM_ID, BOOM_NAME, 'an earlier run failed here');

      const pending = run();
      await expect(pending).rejects.toBeInstanceOf(MigrationFailedError);
      await pending.catch((error: MigrationFailedError) => {
        expect(error.migration.id).toBe(BOOM_ID);
        expect(error.appliedBefore).toEqual([]); // blocked before applying anything
      });

      // The block ran before the apply loop: ok was never applied.
      expect(await readLedgerRow(OK_ID)).toBeUndefined();
    });

    it('repair-retry deletes the failed row so the migration is re-attempted', async () => {
      await db.user.put(makeUser({ PK: 'USER#r1', SK: 'USER#r1', name: 'Rey' }));
      await run().catch(() => {});
      expect(await readLedgerRow(BOOM_ID)).toMatchObject({ status: 'failed' });

      await repair({ tableName, dynamoClient: rawClient, id: BOOM_ID, mode: 'retry' });
      expect(await readLedgerRow(BOOM_ID)).toBeUndefined(); // reverted to pending

      // The next run re-runs boom from the top — it still throws, failing afresh.
      await expect(run()).rejects.toBeInstanceOf(MigrationFailedError);
      expect(await readLedgerRow(BOOM_ID)).toMatchObject({ status: 'failed' });
    });

    it('repair-resolve marks it applied so the line continues past it', async () => {
      await db.user.put(makeUser({ PK: 'USER#r2', SK: 'USER#r2', name: 'Rez' }));
      await run().catch(() => {});

      await repair({ tableName, dynamoClient: rawClient, id: BOOM_ID, mode: 'resolve' });
      expect(await readLedgerRow(BOOM_ID)).toMatchObject({ status: 'applied' });

      // boom is now skipped; the migration after it finally runs.
      const result = await run();
      expect(result.applied).toEqual([AFTER_ID]);
      expect(result.skipped).toEqual([OK_ID, BOOM_ID]);
      expect(await readLedgerRow(AFTER_ID)).toMatchObject({ status: 'applied' });

      const rez = await db.user.get({ PK: 'USER#r2', SK: 'USER#r2' });
      expect(rez?.afterMark).toBe('after');
    });

    it('repair refuses a row that is not failed', async () => {
      await seedApplied(OK_ID, OK_NAME);
      await expect(
        repair({ tableName, dynamoClient: rawClient, id: OK_ID, mode: 'retry' }),
      ).rejects.toThrow(/not "failed"/);
      // The applied row is untouched.
      expect(await readLedgerRow(OK_ID)).toMatchObject({ status: 'applied' });
    });
  });

  describe('dry-run and logger', () => {
    const BACKFILL_NAME = '20260101T0000__backfill-user-status.ts';
    const CAPITALIZE_NAME = '20260102T0000__capitalize-status.ts';

    it('reports what would run, in order, without writing the ledger, data, or lock', async () => {
      await db.user.put(makeUser({ PK: 'USER#dr1', SK: 'USER#dr1', name: 'Dot' }));

      const result = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        dryRun: true,
      });

      // The would-run set, in ascending order.
      expect(result).toEqual({ applied: [BACKFILL_ID, CAPITALIZE_ID], skipped: [] });

      // No ledger rows written.
      expect(await readLedgerRow(BACKFILL_ID)).toBeUndefined();
      expect(await readLedgerRow(CAPITALIZE_ID)).toBeUndefined();
      // Data untouched: the backfill migration would have set a status.
      const dot = await db.user.get({ PK: 'USER#dr1', SK: 'USER#dr1' });
      expect(dot?.status).toBeUndefined();
      // No lock acquired (and so none left behind).
      expect(await readLockRow()).toBeUndefined();
    });

    it('lists already-applied migrations as skipped under dry-run', async () => {
      await seedApplied(BACKFILL_ID, BACKFILL_NAME);

      const result = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        dryRun: true,
      });

      expect(result).toEqual({ applied: [CAPITALIZE_ID], skipped: [BACKFILL_ID] });
    });

    it('is read-only: a dry-run ignores a held lock and writes nothing', async () => {
      await seedLock('other-run');

      const result = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        dryRun: true,
      });

      expect(result.applied).toEqual([BACKFILL_ID, CAPITALIZE_ID]);
      // The other run's lock is untouched — dry-run neither takes nor clears it.
      expect(await readLockRow()).toMatchObject({ actor: 'other-run' });
    });

    it('reports progress for applied and skipped migrations through the injected logger', async () => {
      await db.user.put(makeUser({ PK: 'USER#lg1', SK: 'USER#lg1', name: 'Gus' }));

      const info: string[] = [];
      const warn: string[] = [];
      const logger = { info: (m: string) => info.push(m), warn: (m: string) => warn.push(m) };

      // First run applies both — expect applying/applied signals, no warnings.
      await runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir, logger });
      expect(info).toContain(`applying migration ${BACKFILL_NAME}`);
      expect(info).toContain(`applied migration ${BACKFILL_NAME}`);
      expect(info).toContain(`applying migration ${CAPITALIZE_NAME}`);
      expect(warn).toEqual([]);

      // Second run skips both — expect skip signals.
      info.length = 0;
      await runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir, logger });
      expect(info).toContain(`skipping already-applied migration ${BACKFILL_NAME}`);
      expect(info).toContain(`skipping already-applied migration ${CAPITALIZE_NAME}`);
    });

    it('emits would-apply signals through the logger on a dry-run', async () => {
      const info: string[] = [];
      const logger = { info: (m: string) => info.push(m), warn: () => {} };

      await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        dryRun: true,
        logger,
      });

      expect(info).toContain(`[dry-run] would apply migration ${BACKFILL_NAME}`);
      expect(info).toContain(`[dry-run] would apply migration ${CAPITALIZE_NAME}`);
    });
  });

  describe('checksum verification', () => {
    const BACKFILL_NAME = '20260101T0000__backfill-user-status.ts';

    it('warns and proceeds when an applied migration was edited (default)', async () => {
      await db.user.put(makeUser({ PK: 'USER#cs1', SK: 'USER#cs1', name: 'Cyn' }));
      // Applied with a checksum that cannot match the real file → simulates an edit.
      await seedApplied(BACKFILL_ID, BACKFILL_NAME);

      const warn: string[] = [];
      const logger = { info: () => {}, warn: (m: string) => warn.push(m) };

      const result = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        logger,
      });

      // Warned about the divergence, but did not halt: the pending migration ran.
      expect(warn.some((m) => m.includes(BACKFILL_NAME))).toBe(true);
      expect(result.applied).toEqual([CAPITALIZE_ID]);
      expect(result.skipped).toEqual([BACKFILL_ID]);
    });

    it('rejects with ChecksumMismatchError under onChecksumMismatch: "fail"', async () => {
      await db.user.put(makeUser({ PK: 'USER#cs2', SK: 'USER#cs2', name: 'Cob' }));
      await seedApplied(BACKFILL_ID, BACKFILL_NAME);

      const pending = runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        onChecksumMismatch: 'fail',
      });

      await expect(pending).rejects.toBeInstanceOf(ChecksumMismatchError);
      await pending.catch((error: ChecksumMismatchError) => {
        expect(error.migration.id).toBe(BACKFILL_ID);
        expect(error.expected).toBe('seeded');
        expect(typeof error.actual).toBe('string');
      });

      // It blocked before applying the pending migration.
      expect(await readLedgerRow(CAPITALIZE_ID)).toBeUndefined();
    });

    it('does not warn or throw for an unchanged applied migration', async () => {
      await db.user.put(makeUser({ PK: 'USER#cs3', SK: 'USER#cs3', name: 'Cleo' }));

      // First run records real checksums from the on-disk sources.
      await runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir });

      const warn: string[] = [];
      const logger = { info: () => {}, warn: (m: string) => warn.push(m) };

      // Re-run under the strict mode: unchanged files match, so nothing fires.
      const result = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        onChecksumMismatch: 'fail',
        logger,
      });

      expect(warn).toEqual([]);
      expect(result).toEqual({ applied: [], skipped: [BACKFILL_ID, CAPITALIZE_ID] });
    });
  });

  describe('concurrency lock', () => {
    it('rejects with MigrationLockedError when another run holds the lock', async () => {
      await db.user.put(makeUser({ PK: 'USER#l1', SK: 'USER#l1', name: 'Lou' }));
      await seedLock('other-run');

      const pending = runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
      });
      await expect(pending).rejects.toBeInstanceOf(MigrationLockedError);
      await pending.catch((error: MigrationLockedError) => {
        expect(error.heldBy).toBe('other-run');
        expect(error.acquiredAt).toBe(NOW);
      });

      // The held lock was not overwritten, and nothing was applied.
      expect(await readLockRow()).toMatchObject({ actor: 'other-run' });
      expect(await readLedgerRow(BACKFILL_ID)).toBeUndefined();
    });

    it('releases the lock after a clean run, so a second run proceeds', async () => {
      await db.user.put(makeUser({ PK: 'USER#l2', SK: 'USER#l2', name: 'Liz' }));

      const first = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
      });
      expect(first.applied).toEqual([BACKFILL_ID, CAPITALIZE_ID]);
      expect(await readLockRow()).toBeUndefined(); // released in finally

      // Lock is free, so a second run is not blocked (everything just skips).
      const second = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
      });
      expect(second).toEqual({ applied: [], skipped: [BACKFILL_ID, CAPITALIZE_ID] });
    });

    it('releases the lock after a failed migration', async () => {
      await db.user.put(makeUser({ PK: 'USER#l3', SK: 'USER#l3', name: 'Len' }));

      await expect(
        runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir: failingDir }),
      ).rejects.toBeInstanceOf(MigrationFailedError);

      // Even though the run threw, the lock was cleared in finally.
      expect(await readLockRow()).toBeUndefined();
    });

    it('force-unlock clears a stale lock so a subsequent run proceeds', async () => {
      await db.user.put(makeUser({ PK: 'USER#l4', SK: 'USER#l4', name: 'Mae' }));
      await seedLock('crashed-run');

      const cleared = await forceUnlock({ tableName, dynamoClient: rawClient });
      expect(cleared).toBe(true);
      expect(await readLockRow()).toBeUndefined();

      // A second force-unlock reports nothing left to clear.
      expect(await forceUnlock({ tableName, dynamoClient: rawClient })).toBe(false);

      const result = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
      });
      expect(result.applied).toEqual([BACKFILL_ID, CAPITALIZE_ID]);
    });
  });

  describe('status', () => {
    const BACKFILL_NAME = '20260101T0000__backfill-user-status.ts';
    const CAPITALIZE_NAME = '20260102T0000__capitalize-status.ts';

    const stateOf = (report: Awaited<ReturnType<typeof status>>, id: string) =>
      report.migrations.find((m) => m.id === id)?.state;

    it('reports every migration as pending on a fresh ledger, lock free', async () => {
      const report = await status({ tableName, dynamoClient: rawClient, migrationsDir });

      expect(report.migrations.map((m) => m.id)).toEqual([BACKFILL_ID, CAPITALIZE_ID]);
      expect(report.migrations.every((m) => m.state === 'pending')).toBe(true);
      expect(report.lock).toEqual({ held: false });
    });

    it('classifies applied, pending, and failed from the ledger', async () => {
      await seedApplied(BACKFILL_ID, BACKFILL_NAME);
      await seedFailed(CAPITALIZE_ID, CAPITALIZE_NAME, 'kaboom');

      const report = await status({ tableName, dynamoClient: rawClient, migrationsDir });

      expect(stateOf(report, BACKFILL_ID)).toBe('applied');
      expect(stateOf(report, CAPITALIZE_ID)).toBe('failed');
      const failed = report.migrations.find((m) => m.id === CAPITALIZE_ID);
      expect(failed?.error).toBe('kaboom');
    });

    it('reports a held lock with its actor, and mutates nothing', async () => {
      await seedLock('deploy-7');

      const report = await status({ tableName, dynamoClient: rawClient, migrationsDir });

      expect(report.lock).toMatchObject({ held: true, actor: 'deploy-7', acquiredAt: NOW });
      // Read-only: the seeded lock and an empty ledger are untouched.
      expect(await readLockRow()).toMatchObject({ actor: 'deploy-7' });
      expect(await readLedgerRow(BACKFILL_ID)).toBeUndefined();
    });
  });
});
