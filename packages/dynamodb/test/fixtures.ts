import { defineEntity } from '../src';

export const userEntity = defineEntity<'USER', UserItem, ['GSI1']>(
  'USER',
  { indexes: ['GSI1'] },
);

export const entities = { user: userEntity };

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
