import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
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
  const key = { PK: 'USER#x', SK: 'USER#x' };
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
