import type { AppClient } from '../../fixtures.js';

// Succeeds: marks every user idempotently. Runs before the deliberately-throwing
// migration, so it is the one entry in MigrationFailedError.appliedBefore.
export const up = async ({ db }: { db: AppClient }): Promise<void> => {
  const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
  for (const user of users) {
    if (user.okMark === undefined) {
      await db.user.update({ PK: user.PK, SK: user.SK }, { okMark: 'ok' });
    }
  }
};
