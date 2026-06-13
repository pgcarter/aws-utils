import type { AppClient } from '../../fixtures.js';

// Sits after the throwing migration. It must NOT run while boom is failed, and
// only runs once boom is resolved — proving the line continues past a resolve.
export const up = async ({ db }: { db: AppClient }): Promise<void> => {
  const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
  for (const user of users) {
    if (user.afterMark === undefined) {
      await db.user.update({ PK: user.PK, SK: user.SK }, { afterMark: 'after' });
    }
  }
};
