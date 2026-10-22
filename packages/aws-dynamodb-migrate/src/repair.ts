import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createLedgerClient, DEFAULT_ACTOR, LEDGER_PK, type LedgerActor } from './ledger.js';

/**
 * How to repair a `failed` migration. Both are human-initiated — the tool never
 * repairs automatically.
 *
 * - `retry`: delete the failed ledger row, so the migration reverts to pending
 *   and re-runs from the top on the next run. Use after confirming the data is
 *   safe to re-process (the `up` must be idempotent).
 * - `resolve`: flip the row to `applied`, so the migration is skipped forever.
 *   Use after fixing the data by hand.
 */
export type RepairMode = 'retry' | 'resolve';

export interface RepairOptions {
  /** The table the ledger lives in. */
  tableName: string;
  /** Raw client carrying region/creds/endpoint, used to build the internal ledger client. */
  dynamoClient?: DynamoDBClient;
  /** The id (timestamp prefix) of the failed migration to repair. */
  id: string;
  /** Which repair to perform. */
  mode: RepairMode;
  /** Actor recorded in ledger audit fields. Defaults to the tool's own identity. */
  actor?: LedgerActor;
}

/**
 * Repair a single `failed` migration so the line can move again. Refuses to act
 * on a row that is missing or not in `failed` status, so an applied migration is
 * never accidentally deleted or re-marked.
 */
export const repair = async (options: RepairOptions): Promise<void> => {
  const { tableName, dynamoClient, id, mode, actor = DEFAULT_ACTOR } = options;
  const ledger = createLedgerClient(tableName, dynamoClient, actor);

  const row = await ledger.ledger.get({ PK: LEDGER_PK, SK: id });
  if (!row) {
    throw new Error(`Cannot repair migration ${id}: no ledger row found.`);
  }
  if (row.status !== 'failed') {
    throw new Error(
      `Cannot repair migration ${id}: its status is "${row.status}", not "failed".`,
    );
  }

  if (mode === 'retry') {
    await ledger.ledger.delete({ PK: LEDGER_PK, SK: id });
  } else {
    await ledger.ledger.update({ PK: LEDGER_PK, SK: id }, { status: 'applied' }, ['error']);
  }
};
