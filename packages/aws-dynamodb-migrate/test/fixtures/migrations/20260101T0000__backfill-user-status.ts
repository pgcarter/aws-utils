import type { AppClient } from '../../fixtures.js';

// Idempotent: only writes a status to users that lack one, so a retry over
// already-transformed items is a no-op.
export const up = async ({ db }: { db: AppClient }): Promise<void> => {
  const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
  for (const user of users) {
    if (user.status === undefined) {
      await db.user.update({ PK: user.PK, SK: user.SK }, { status: 'active' });
    }
  }
};
