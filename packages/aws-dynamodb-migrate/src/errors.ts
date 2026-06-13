import type { DiscoveredMigration } from './discovery.js';

/**
 * Thrown when a migration's `up` throws, or when a prior run left a `failed`
 * ledger row that still blocks the line. DynamoDB has no transactions, so an
 * `up` is a loop of independent writes: a throw partway through leaves permanent
 * partial writes. On failure the core records a `status: 'failed'` ledger row,
 * halts (no later migration runs), and rejects with this error. A `failed` row
 * blocks every subsequent run until a human repairs it (retry or resolve).
 *
 * Because a retried migration re-runs from the top over possibly-half-transformed
 * items, every `up` MUST be idempotent so re-processing an item is a safe no-op.
 */
export class MigrationFailedError extends Error {
  /** The migration whose `up` threw (or whose `failed` row is blocking). */
  readonly migration: DiscoveredMigration;
  /** The original error thrown by `up`, or the recorded cause of a prior failure. */
  override readonly cause: unknown;
  /** Ids applied successfully this run before the failure (empty for a pre-existing block). */
  readonly appliedBefore: readonly string[];

  constructor(
    migration: DiscoveredMigration,
    cause: unknown,
    appliedBefore: readonly string[],
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Migration ${migration.name} failed: ${reason}. The line is halted until ` +
        `it is repaired (retry to re-run from the top, or resolve to mark applied).`,
    );
    this.name = 'MigrationFailedError';
    this.migration = migration;
    this.cause = cause;
    this.appliedBefore = appliedBefore;
  }
}

/**
 * Thrown when another run already holds the migration lock. Before applying
 * anything, `runMigrations` takes a single lock item in the `DB_MIGRATE`
 * partition with a conditional `attribute_not_exists` write; if that write
 * fails, a concurrent run holds the lock and this is thrown rather than risk
 * double-applying a migration. The lock is released in a `finally`, so it clears
 * after both a clean run and a failed migration. A lock left behind by a crashed
 * run is stale — clear it with the force-unlock primitive (`unlock --force`).
 *
 * Distinct from {@link MigrationFailedError} so a release pipeline can treat
 * "another deploy is already running" differently from a genuine failure.
 */
export class MigrationLockedError extends Error {
  /** The actor id recorded on the held lock, if it could be read. */
  readonly heldBy?: string;
  /** The ISO timestamp the held lock was acquired, if it could be read. */
  readonly acquiredAt?: string;

  constructor(heldBy?: string, acquiredAt?: string) {
    const who = heldBy
      ? ` (held by ${heldBy}${acquiredAt ? ` since ${acquiredAt}` : ''})`
      : '';
    super(
      `Another migration run holds the lock${who}; refusing to run concurrently. ` +
        `If a previous run crashed, clear the stale lock with unlock --force.`,
    );
    this.name = 'MigrationLockedError';
    this.heldBy = heldBy;
    this.acquiredAt = acquiredAt;
  }
}

/**
 * Thrown when an already-applied migration's source on disk no longer matches
 * the checksum recorded when it ran — i.e. someone edited a migration after it
 * was applied. Because an applied migration is never re-run, the edited file and
 * the data it produced have silently diverged. The core re-hashes every
 * already-applied migration's on-disk source on each run and compares it to the
 * stored checksum.
 *
 * Only thrown under `onChecksumMismatch: 'fail'`. The default `'warn'` logs the
 * mismatch through the logger and proceeds, leaving the strictness choice to the
 * caller.
 */
export class ChecksumMismatchError extends Error {
  /** The already-applied migration whose on-disk source has changed. */
  readonly migration: DiscoveredMigration;
  /** The checksum recorded in the ledger when the migration was applied. */
  readonly expected: string;
  /** The checksum of the migration's current on-disk source. */
  readonly actual: string;

  constructor(migration: DiscoveredMigration, expected: string, actual: string) {
    super(
      `Migration ${migration.name} was edited after it was applied: its source ` +
        `checksum (${actual}) no longer matches the one recorded when it ran ` +
        `(${expected}). An applied migration must be immutable. Revert the file ` +
        `to what actually ran, or pass onChecksumMismatch: 'warn' to proceed.`,
    );
    this.name = 'ChecksumMismatchError';
    this.migration = migration;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Thrown when strict ordering is in force and a pending migration is older than
 * the newest migration already recorded in the ledger — the situation caused by
 * merging an old branch after a newer migration has already run. Applying it
 * would run data transformations out of the sequence their authors intended, so
 * `runMigrations` rejects before applying anything further.
 *
 * Pass `allowOutOfOrder: true` to downgrade this to permitted behaviour.
 */
export class OutOfOrderError extends Error {
  /** The pending migration that is older than the newest applied one. */
  readonly migration: DiscoveredMigration;
  /** The id of the newest migration already recorded in the ledger. */
  readonly newestApplied: string;

  constructor(migration: DiscoveredMigration, newestApplied: string) {
    super(
      `Migration ${migration.name} is older than the newest applied migration (${newestApplied}); ` +
        `refusing to apply out of order. Pass allowOutOfOrder: true to override.`,
    );
    this.name = 'OutOfOrderError';
    this.migration = migration;
    this.newestApplied = newestApplied;
  }
}
