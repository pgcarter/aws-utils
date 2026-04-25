import { defineEntity } from '../src';

export type Actor = { id: string };

export const TEST_ACTOR: Actor = { id: 'tester' };

export const getActor = (): Actor => TEST_ACTOR;

export const userEntity = defineEntity<'USER', UserItem, ['GSI1']>(
  'USER',
  { indexes: ['GSI1'] },
);

type CacheItem = {
  PK: `CACHE#${string}`;
  SK: `CACHE#${string}`;
  value: string;
};

export const cacheEntity = defineEntity<'CACHE', CacheItem, [], false>(
  'CACHE',
  { audit: false },
);

export const entities = { user: userEntity, cache: cacheEntity };

type UserItem = {
  PK: `USER#${string}`;
  SK: `USER#${string}`;
  GSI1PK?: 'USERS';
  GSI1SK?: string;
  name: string;
  email: string;
};

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
