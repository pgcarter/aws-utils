import type { AppClient } from '../../fixtures.js';

// Deliberately throws to exercise the failure path: a `failed` ledger row is
// written and the line halts before any later migration runs.
export const up = async (_ctx: { db: AppClient }): Promise<void> => {
  throw new Error('boom: migration failed on purpose');
};
