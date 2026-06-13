import { readdir } from 'node:fs/promises';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { discoverMigrations } from './discovery.js';
import {
  createLedgerClient,
  DEFAULT_ACTOR,
  LEDGER_PK,
  type LedgerActor,
} from './ledger.js';
import { createLockClient, LOCK_SK } from './lock.js';

/** Where a migration stands relative to the ledger. */
export type MigrationState = 'applied' | 'pending' | 'failed';

/** One migration's standing: its id, human name, state, and failure message if failed. */
export interface MigrationStatusRow {
  /** Timestamp-prefix id (source of truth for identity and ordering). */
  id: string;
  /** Human filename, from disk where present, else the name recorded in the ledger. */
  name: string;
  /** `applied`/`failed` come from the ledger; `pending` means on disk but not yet applied. */
  state: MigrationState;
  /** The recorded failure message, present only on a `failed` row. */
  error?: string;
}

/** Whether a run currently holds the lock, and who took it. */
export interface LockStatus {
  /** True when a lock row is present (a run is in progress, or a stale lock remains). */
  held: boolean;
  /** The actor id recorded on the held lock. */
  actor?: string;
  /** The ISO timestamp the held lock was acquired. */
  acquiredAt?: string;
}

/** A read-only snapshot of every migration's state plus the lock. */
export interface StatusReport {
  /** Every migration (union of on-disk and ledger), ascending by id. */
  migrations: MigrationStatusRow[];
  /** Whether the migration lock is currently held. */
  lock: LockStatus;
}

export interface StatusOptions {
  /** The table the ledger and lock live in. */
  tableName: string;
  /** Raw client carrying region/creds/endpoint, used to build the internal ledger/lock clients. */
  dynamoClient?: DynamoDBClient;
  /** Absolute path to the directory of migration modules. */
  migrationsDir: string;
  /** Actor recorded in ledger audit fields. Defaults to the tool's own identity. */
  actor?: LedgerActor;
}

/**
 * Report the state of every migration and whether the lock is held — read-only,
 * mutating nothing. The migration set is the union of what is on disk and what
 * the ledger records, so a row that was applied (or failed) but whose file has
 * since been removed still shows up. Each row is classified `applied`/`failed`
 * from the ledger, or `pending` when it is on disk but not yet recorded. Backs
 * the `status` CLI command.
 */
export const status = async (options: StatusOptions): Promise<StatusReport> => {
  const { tableName, dynamoClient, migrationsDir, actor = DEFAULT_ACTOR } = options;

  const ledger = createLedgerClient(tableName, dynamoClient, actor);
  const lockClient = createLockClient(tableName, dynamoClient, actor);

  const discovered = discoverMigrations(await readdir(migrationsDir));
  const ledgerRows = await ledger.ledger.pagedQuery({ pk: LEDGER_PK });

  const rowById = new Map(ledgerRows.map((row) => [row.SK, row]));
  const nameById = new Map(discovered.map((m) => [m.id, m.name]));

  // Union of disk and ledger ids: a migration removed from disk after it ran is
  // still part of the table's history and should be reported.
  const ids = new Set<string>([...nameById.keys(), ...rowById.keys()]);

  const migrations: MigrationStatusRow[] = [...ids]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => {
      const row = rowById.get(id);
      const name = nameById.get(id) ?? row?.name ?? id;
      const state: MigrationState = row?.status === 'failed' ? 'failed' : row ? 'applied' : 'pending';
      return row?.error ? { id, name, state, error: row.error } : { id, name, state };
    });

  const lockRow = await lockClient.lock.get({ PK: LEDGER_PK, SK: LOCK_SK });
  const lock: LockStatus = lockRow
    ? { held: true, actor: lockRow.actor, acquiredAt: lockRow.acquiredAt }
    : { held: false };

  return { migrations, lock };
};
