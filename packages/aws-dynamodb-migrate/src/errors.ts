import type { DiscoveredMigration } from './discovery.js';

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
