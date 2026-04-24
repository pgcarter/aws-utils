import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDynamoClient, type DynamoClient } from '../src';
import { entities, makeUser } from './fixtures';

const endpoint = process.env.DYNAMODB_TEST_ENDPOINT!;
const tableName = process.env.DYNAMODB_TEST_TABLE!;

let rawClient: DynamoDBClient;
let db: DynamoClient<typeof entities>;

beforeAll(() => {
  rawClient = new DynamoDBClient({
    endpoint,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  db = createDynamoClient({ tableName, entities, client: rawClient });
});

afterAll(() => {
  rawClient.destroy();
});

describe('put', () => {
  it('writes an item that can be read back with the type attribute set', async () => {
    const alice = makeUser({ PK: 'USER#1', name: 'Alice' });
    const created = await db.user.put(alice);

    expect(created).toEqual({ ...alice, type: 'USER' });

    const fetched = await db.user.get({ PK: alice.PK, SK: alice.SK });
    expect(fetched).toEqual(created);
  });

  it('overwrites an existing item at the same key', async () => {
    const bob = makeUser({ PK: 'USER#2', name: 'Bob' });
    await db.user.put(bob);

    const bobby = makeUser({ PK: 'USER#2', name: 'Bobby' });
    await db.user.put(bobby);

    const fetched = await db.user.get({ PK: bob.PK, SK: bob.SK });
    expect(fetched).toMatchObject({ name: 'Bobby', email: 'bobby@example.com' });
  });
});

describe('query', () => {
  it('finds an item by GSI1', async () => {
    const alice = makeUser({ PK: 'USER#gsi-alice', name: 'Alice' });
    const created = await db.user.put(alice);

    const results = await db.user.pagedQuery({
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
});
