import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDynamoClient, type DynamoClient } from '../src';
import { type Actor, entities, getActor, makeUser, TEST_ACTOR } from './fixtures';

const endpoint = process.env.DYNAMODB_TEST_ENDPOINT!;
const tableName = process.env.DYNAMODB_TEST_TABLE!;

const NOW = '2026-04-25T12:00:00.000Z';

let rawClient: DynamoDBClient;
let db: DynamoClient<typeof entities, Actor>;

beforeAll(() => {
  rawClient = new DynamoDBClient({
    endpoint,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  db = createDynamoClient({ tableName, entities, client: rawClient, getActor });
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  rawClient.destroy();
});

describe('put', () => {
  it('writes an item with audit fields populated from getActor and the system clock', async () => {
    const alice = makeUser({ PK: 'USER#1', name: 'Alice' });
    const created = await db.user.put(alice);

    expect(created).toEqual({
      ...alice,
      type: 'USER',
      createdAt: NOW,
      createdBy: TEST_ACTOR,
      modifiedAt: NOW,
      modifiedBy: TEST_ACTOR,
    });

    const fetched = await db.user.get({ PK: alice.PK, SK: alice.SK });
    expect(fetched).toEqual(created);
  });

  it('rejects a put when an item already exists at the same key', async () => {
    const dup = makeUser({ PK: 'USER#dup' });
    await db.user.put(dup);

    await expect(db.user.put(dup)).rejects.toThrow(/conditional/i);
  });

  it('overwrites an existing item at the same key via upsert', async () => {
    const bob = makeUser({ PK: 'USER#overwrite', name: 'Bob' });
    await db.user.put(bob);

    await db.user.upsert(
      { PK: bob.PK, SK: bob.SK },
      {
        GSI1PK: 'USERS',
        GSI1SK: 'bobby',
        name: 'Bobby',
        email: 'bobby@example.com',
      },
    );

    const fetched = await db.user.get({ PK: bob.PK, SK: bob.SK });
    expect(fetched).toMatchObject({ name: 'Bobby', email: 'bobby@example.com' });
  });

  it('writes no audit fields for entities defined with audit: false', async () => {
    const created = await db.cache.put({
      PK: 'CACHE#1',
      SK: 'CACHE#1',
      value: 'cached',
    });

    expect(created).toEqual({
      PK: 'CACHE#1',
      SK: 'CACHE#1',
      value: 'cached',
      type: 'CACHE',
    });
    expect(created).not.toHaveProperty('createdAt');
    expect(created).not.toHaveProperty('createdBy');
    expect(created).not.toHaveProperty('modifiedAt');
    expect(created).not.toHaveProperty('modifiedBy');

    const fetched = await db.cache.get({ PK: 'CACHE#1', SK: 'CACHE#1' });
    expect(fetched).not.toHaveProperty('createdAt');
  });
});

describe('query', () => {
  it('finds an item by GSI1', async () => {
    const alice = makeUser({ PK: 'USER#gsi-alice', name: 'Alice' });
    await db.user.put(alice);

    await db.user.pagedQuery({
      index: 'GSI1',
      pk: 'USERS',
      sk: { beginsWith: 'a' },
    });
  });
});

describe('update', () => {
  it('removes GSI attributes from an existing item', async () => {
    const gina = makeUser({ PK: 'USER#remove-gsi', name: 'Gina' });
    await db.user.put(gina);

    const updated = await db.user.update(
      { PK: gina.PK, SK: gina.SK },
      {},
      ['GSI1PK', 'GSI1SK'],
    );

    expect(updated.GSI1PK).toBeUndefined();
    expect(updated.GSI1SK).toBeUndefined();

    const fetched = await db.user.get({ PK: gina.PK, SK: gina.SK });
    expect(fetched?.GSI1PK).toBeUndefined();
    expect(fetched?.GSI1SK).toBeUndefined();
  });

  it('updates only modifiedAt/modifiedBy and preserves createdAt/createdBy on an audited row', async () => {
    const user = makeUser({ PK: 'USER#mod-only' });
    await db.user.put(user);

    const LATER = '2026-05-01T08:30:00.000Z';
    vi.setSystemTime(new Date(LATER));

    const updated = await db.user.update(
      { PK: user.PK, SK: user.SK },
      { name: 'Updated' },
    );

    expect(updated.createdAt).toBe(NOW);
    expect(updated.createdBy).toEqual(TEST_ACTOR);
    expect(updated.modifiedAt).toBe(LATER);
    expect(updated.modifiedBy).toEqual(TEST_ACTOR);
    expect(updated.name).toBe('Updated');
  });

  it('self-heals all four audit fields on a legacy row that predates audit', async () => {
    const PK = 'USER#legacy';
    const doc = DynamoDBDocumentClient.from(rawClient);
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK,
          SK: PK,
          type: 'USER',
          name: 'Legacy',
          email: 'legacy@example.com',
        },
      }),
    );

    const updated = await db.user.update({ PK, SK: PK }, { name: 'Healed' });

    expect(updated.createdAt).toBe(NOW);
    expect(updated.createdBy).toEqual(TEST_ACTOR);
    expect(updated.modifiedAt).toBe(NOW);
    expect(updated.modifiedBy).toEqual(TEST_ACTOR);
    expect(updated.name).toBe('Healed');
  });

  it('writes no audit fields when updating an entity defined with audit: false', async () => {
    await db.cache.put({ PK: 'CACHE#u', SK: 'CACHE#u', value: 'v1' });
    const updated = await db.cache.update(
      { PK: 'CACHE#u', SK: 'CACHE#u' },
      { value: 'v2' },
    );

    expect(updated.value).toBe('v2');
    expect(updated).not.toHaveProperty('createdAt');
    expect(updated).not.toHaveProperty('createdBy');
    expect(updated).not.toHaveProperty('modifiedAt');
    expect(updated).not.toHaveProperty('modifiedBy');
  });
});

describe('upsert', () => {
  it('updates only modifiedAt/modifiedBy and preserves createdAt/createdBy on an existing audited row', async () => {
    const user = makeUser({ PK: 'USER#upsert-mod-only' });
    await db.user.put(user);

    const LATER = '2026-05-01T08:30:00.000Z';
    vi.setSystemTime(new Date(LATER));

    const updated = await db.user.upsert(
      { PK: user.PK, SK: user.SK },
      { name: 'Updated', email: user.email },
    );

    expect(updated.createdAt).toBe(NOW);
    expect(updated.createdBy).toEqual(TEST_ACTOR);
    expect(updated.modifiedAt).toBe(LATER);
    expect(updated.modifiedBy).toEqual(TEST_ACTOR);
    expect(updated.name).toBe('Updated');
  });

  it('creates a missing row with all four audit fields populated', async () => {
    const PK = 'USER#upsert-create';
    const created = await db.user.upsert(
      { PK, SK: PK },
      {
        GSI1PK: 'USERS',
        GSI1SK: 'newbie',
        name: 'Newbie',
        email: 'newbie@example.com',
      },
    );

    expect(created.createdAt).toBe(NOW);
    expect(created.createdBy).toEqual(TEST_ACTOR);
    expect(created.modifiedAt).toBe(NOW);
    expect(created.modifiedBy).toEqual(TEST_ACTOR);
    expect(created.name).toBe('Newbie');

    const fetched = await db.user.get({ PK, SK: PK });
    expect(fetched).toEqual(created);
  });

  it('self-heals all four audit fields on a legacy row that predates audit', async () => {
    const PK = 'USER#upsert-legacy';
    const doc = DynamoDBDocumentClient.from(rawClient);
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK,
          SK: PK,
          type: 'USER',
          name: 'Legacy',
          email: 'legacy@example.com',
        },
      }),
    );

    const updated = await db.user.upsert(
      { PK, SK: PK },
      { name: 'Healed', email: 'legacy@example.com' },
    );

    expect(updated.createdAt).toBe(NOW);
    expect(updated.createdBy).toEqual(TEST_ACTOR);
    expect(updated.modifiedAt).toBe(NOW);
    expect(updated.modifiedBy).toEqual(TEST_ACTOR);
    expect(updated.name).toBe('Healed');
  });

  it('writes no audit fields when upserting an entity defined with audit: false', async () => {
    const created = await db.cache.upsert(
      { PK: 'CACHE#upsert', SK: 'CACHE#upsert' },
      { value: 'fresh' },
    );

    expect(created.value).toBe('fresh');
    expect(created).not.toHaveProperty('createdAt');
    expect(created).not.toHaveProperty('createdBy');
    expect(created).not.toHaveProperty('modifiedAt');
    expect(created).not.toHaveProperty('modifiedBy');
  });
});

describe('delete', () => {
  it('removes an existing row and returns the deleted entity (idempotent default)', async () => {
    const user = makeUser({ PK: 'USER#del-existing' });
    const created = await db.user.put(user);

    const removed = await db.user.delete({ PK: user.PK, SK: user.SK });

    expect(removed).toEqual(created);
    const fetched = await db.user.get({ PK: user.PK, SK: user.SK });
    expect(fetched).toBeUndefined();
  });

  it('resolves to undefined when the row is missing (idempotent default)', async () => {
    const removed = await db.user.delete({
      PK: 'USER#del-missing',
      SK: 'USER#del-missing',
    });

    expect(removed).toBeUndefined();
  });

  it('throws when the row exists but its type does not match (idempotent default)', async () => {
    const PK = 'USER#del-wrong-type';
    const doc = DynamoDBDocumentClient.from(rawClient);
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: { PK, SK: PK, type: 'CACHE', value: 'wrong' },
      }),
    );

    await expect(db.user.delete({ PK, SK: PK })).rejects.toThrow(/conditional/i);

    const { Item } = await doc.send(
      new GetCommand({ TableName: tableName, Key: { PK, SK: PK } }),
    );
    expect(Item).toBeDefined();
    expect(Item?.type).toBe('CACHE');
  });

  it('removes an existing right-type row in strict mode', async () => {
    const user = makeUser({ PK: 'USER#del-strict-existing' });
    const created = await db.user.put(user);

    const removed = await db.user.delete({ PK: user.PK, SK: user.SK }, { strict: true });

    expect(removed).toEqual(created);
    const fetched = await db.user.get({ PK: user.PK, SK: user.SK });
    expect(fetched).toBeUndefined();
  });

  it('throws when the row is missing in strict mode', async () => {
    await expect(
      db.user.delete(
        { PK: 'USER#del-strict-missing', SK: 'USER#del-strict-missing' },
        { strict: true },
      ),
    ).rejects.toThrow(/conditional/i);
  });

  it('throws when the row exists but is the wrong type in strict mode', async () => {
    const PK = 'USER#del-strict-wrong-type';
    const doc = DynamoDBDocumentClient.from(rawClient);
    await doc.send(
      new PutCommand({
        TableName: tableName,
        Item: { PK, SK: PK, type: 'CACHE', value: 'wrong' },
      }),
    );

    await expect(
      db.user.delete({ PK, SK: PK }, { strict: true }),
    ).rejects.toThrow(/conditional/i);
  });

  it('behaves identically for an audit:false entity', async () => {
    await db.cache.put({ PK: 'CACHE#del', SK: 'CACHE#del', value: 'v' });

    const removed = await db.cache.delete({ PK: 'CACHE#del', SK: 'CACHE#del' });
    expect(removed).toEqual({
      PK: 'CACHE#del',
      SK: 'CACHE#del',
      value: 'v',
      type: 'CACHE',
    });

    const missing = await db.cache.delete({ PK: 'CACHE#del', SK: 'CACHE#del' });
    expect(missing).toBeUndefined();

    await expect(
      db.cache.delete({ PK: 'CACHE#del', SK: 'CACHE#del' }, { strict: true }),
    ).rejects.toThrow(/conditional/i);
  });
});

// Type-only narrowing guard: strict:true narrows the return to non-undefined.
async function _deleteStrictReturnIsNonNullable(client: typeof db) {
  const key = { PK: 'USER#x', SK: 'USER#x' } as const;
  const removed = await client.user.delete(key, { strict: true });
  // Should not require a null check — non-nullable in strict mode.
  removed.PK;

  const maybeRemoved = await client.user.delete(key);
  // @ts-expect-error - default mode returns Entity | undefined, not narrowed
  maybeRemoved.PK;
}
void _deleteStrictReturnIsNonNullable;

// Type-only spoof guard: callers cannot pass audit fields to put().
// This function is never invoked; the // @ts-expect-error directives are
// validated at typecheck time.
function _putRejectsAuditFieldsAtCompileTime(client: typeof db) {
  // @ts-expect-error - createdAt is reserved by audit
  client.user.put({ ...makeUser(), createdAt: '2020-01-01T00:00:00.000Z' });
  // @ts-expect-error - createdBy is reserved by audit
  client.user.put({ ...makeUser(), createdBy: { id: 'spoofed' } });
  // @ts-expect-error - modifiedAt is reserved by audit
  client.user.put({ ...makeUser(), modifiedAt: '2020-01-01T00:00:00.000Z' });
  // @ts-expect-error - modifiedBy is reserved by audit
  client.user.put({ ...makeUser(), modifiedBy: { id: 'spoofed' } });
}
void _putRejectsAuditFieldsAtCompileTime;

// Type-only spoof guard: callers cannot pass audit fields to update().
function _updateRejectsAuditFieldsAtCompileTime(client: typeof db) {
  const key = { PK: 'USER#x', SK: 'USER#x' } as const;
  // @ts-expect-error - createdAt is reserved by audit
  client.user.update(key, { createdAt: '2020-01-01T00:00:00.000Z' });
  // @ts-expect-error - createdBy is reserved by audit
  client.user.update(key, { createdBy: { id: 'spoofed' } });
  // @ts-expect-error - modifiedAt is reserved by audit
  client.user.update(key, { modifiedAt: '2020-01-01T00:00:00.000Z' });
  // @ts-expect-error - modifiedBy is reserved by audit
  client.user.update(key, { modifiedBy: { id: 'spoofed' } });
}
void _updateRejectsAuditFieldsAtCompileTime;
