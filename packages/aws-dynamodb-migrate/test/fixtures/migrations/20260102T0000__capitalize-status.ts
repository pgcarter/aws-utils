import type { AppClient } from '../../fixtures.js';

// Runs after the backfill: upper-cases the status set by the previous
// migration. Idempotent — upper-casing an already-upper string is a no-op.
export const up = async ({ db }: { db: AppClient }): Promise<void> => {
  const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
  for (const user of users) {
    if (user.status !== undefined && user.status !== user.status.toUpperCase()) {
      await db.user.update({ PK: user.PK, SK: user.SK }, { status: user.status.toUpperCase() });
    }
  }
};
