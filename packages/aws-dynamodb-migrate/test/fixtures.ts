import { createDynamoClient, defineEntity, type DynamoClient } from '@bm8/aws-dynamodb';

export type Actor = { id: string };

export const TEST_ACTOR: Actor = { id: 'tester' };

export const getActor = (): Actor => TEST_ACTOR;

export type UserItem = {
  PK: `USER#${string}`;
  SK: `USER#${string}`;
  GSI1PK?: 'USERS';
  GSI1SK?: string;
  name: string;
  email: string;
  status?: string;
};

export const userEntity = defineEntity<'USER', UserItem, ['GSI1']>('USER', {
  indexes: ['GSI1'],
});

export const entities = { user: userEntity };

export type AppClient = DynamoClient<typeof entities, Actor>;

export const makeUserClient = (
  tableName: string,
  client: import('@aws-sdk/client-dynamodb').DynamoDBClient,
): AppClient => createDynamoClient({ tableName, entities, client, getActor });

export const makeUser = (overrides: Partial<UserItem> = {}): UserItem => {
  const id = overrides.PK ?? `USER#${Math.random().toString(36).slice(2, 10)}`;
  const name = overrides.name ?? 'Alice';
  return {
    PK: id,
    SK: id,
    GSI1PK: 'USERS',
    GSI1SK: name.toLowerCase(),
    name,
    email: `${name.toLowerCase()}@example.com`,
    ...overrides,
  };
};
