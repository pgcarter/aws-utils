import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createDynamoClient, defineEntity, type DynamoClient } from '@bm8/aws-dynamodb';

/** The partition every ledger row (and the lock) lives in, within the user's table. */
export const LEDGER_PK = 'DB_MIGRATE' as const;

/** Status of a recorded migration. `failed` halts the line until repaired (retry/resolve). */
export type LedgerStatus = 'applied' | 'failed';

/**
 * A ledger row: the durable record that a migration ran against this table.
 * Lives in the target table's `DB_MIGRATE` partition; the `type` discriminator
 * keeps it out of users' entity queries.
 */
export type LedgerAttrs = {
  PK: typeof LEDGER_PK;
  SK: string; // the migration id (timestamp prefix)
  name: string; // the human filename
  checksum: string; // hash of the migration's source bytes at apply time
  status: LedgerStatus;
  error?: string; // failure message, recorded only on a `failed` row
};

/** Actor recorded in the ledger's audit fields — who ran the migration. */
export type LedgerActor = { id: string };

/** Default actor when the caller does not supply one. */
export const DEFAULT_ACTOR: LedgerActor = { id: 'dynamodb-migrate' };

const ledgerEntity = defineEntity<typeof LEDGER_PK, LedgerAttrs>(LEDGER_PK);

const ledgerEntities = { ledger: ledgerEntity };

export type LedgerClient = DynamoClient<typeof ledgerEntities, LedgerActor>;

/**
 * Stand up the core's *own* internal client for persisting the ledger, against
 * the same table the user's migrations target. This is deliberately separate
 * from the user's forwarded `client`: it isolates "how the ledger is stored"
 * from "the client migrations use".
 */
export const createLedgerClient = (
  tableName: string,
  dynamoClient: DynamoDBClient | undefined,
  actor: LedgerActor,
): LedgerClient =>
  createDynamoClient({
    tableName,
    entities: ledgerEntities,
    client: dynamoClient,
    getActor: () => actor,
  });
