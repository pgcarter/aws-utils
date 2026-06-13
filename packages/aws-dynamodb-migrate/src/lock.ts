import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createDynamoClient, defineEntity, type DynamoClient } from '@bm8/aws-dynamodb';
import { MigrationLockedError } from './errors.js';
import { DEFAULT_ACTOR, LEDGER_PK, type LedgerActor } from './ledger.js';

/** The single sort key the lock row occupies within the `DB_MIGRATE` partition. */
export const LOCK_SK = 'LOCK' as const;

/**
 * The lock row: a single item whose mere presence in the `DB_MIGRATE` partition
 * means a run is in progress. Carries who took it and when, so a stale lock left
 * by a crashed run can be attributed before it is force-cleared. Its own `type`
 * discriminator (`DB_MIGRATE_LOCK`) keeps it out of the ledger's `pagedQuery`.
 */
export type LockAttrs = {
  PK: typeof LEDGER_PK;
  SK: typeof LOCK_SK;
  actor: string; // the actor id that holds the lock
  acquiredAt: string; // ISO timestamp the lock was taken
};

const lockEntity = defineEntity<'DB_MIGRATE_LOCK', LockAttrs, readonly [], false>(
  'DB_MIGRATE_LOCK',
  { audit: false },
);

const lockEntities = { lock: lockEntity };

export type LockClient = DynamoClient<typeof lockEntities, LedgerActor>;

/**
 * Stand up the core's internal client for the lock row, against the same table
 * the ledger and migrations target. Mirrors {@link createLedgerClient}.
 */
export const createLockClient = (
  tableName: string,
  dynamoClient: DynamoDBClient | undefined,
  actor: LedgerActor,
): LockClient =>
  createDynamoClient({
    tableName,
    entities: lockEntities,
    client: dynamoClient,
    getActor: () => actor,
  });

/**
 * Take the lock with a conditional create (`attribute_not_exists`). If another
 * run already holds it the conditional write fails, and this rejects with
 * {@link MigrationLockedError} reporting the current holder — never overwriting
 * the standing lock.
 */
export const acquireLock = async (
  client: LockClient,
  actorId: string,
  acquiredAt: string,
): Promise<void> => {
  try {
    await client.lock.put({ PK: LEDGER_PK, SK: LOCK_SK, actor: actorId, acquiredAt });
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      // Best-effort read of who holds it, to make the error actionable.
      const held = await client.lock.get({ PK: LEDGER_PK, SK: LOCK_SK });
      throw new MigrationLockedError(held?.actor, held?.acquiredAt);
    }
    throw error;
  }
};

/**
 * Release the lock. Deletes the lock row idempotently — a no-op if it is already
 * gone, so it is safe to call from a `finally` regardless of how the run ended.
 */
export const releaseLock = async (client: LockClient): Promise<void> => {
  await client.lock.delete({ PK: LEDGER_PK, SK: LOCK_SK });
};

export interface ForceUnlockOptions {
  /** The table the lock lives in. */
  tableName: string;
  /** Raw client carrying region/creds/endpoint, used to build the internal lock client. */
  dynamoClient?: DynamoDBClient;
  /** Actor recorded in ledger audit fields. Defaults to the tool's own identity. */
  actor?: LedgerActor;
}

/**
 * Human-initiated clearing of a stale lock left by a crashed run. Deletes the
 * lock row unconditionally and reports whether one was actually present, so a
 * caller (e.g. `unlock --force`) can distinguish "cleared a held lock" from
 * "nothing was locked".
 */
export const forceUnlock = async (options: ForceUnlockOptions): Promise<boolean> => {
  const { tableName, dynamoClient, actor = DEFAULT_ACTOR } = options;
  const client = createLockClient(tableName, dynamoClient, actor);
  const removed = await client.lock.delete({ PK: LEDGER_PK, SK: LOCK_SK });
  return removed !== undefined;
};
