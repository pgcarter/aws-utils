import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutOfOrderError, runMigrations } from '../src';
import { type AppClient, makeUser, makeUserClient } from './fixtures';

const endpoint = process.env.DYNAMODB_TEST_ENDPOINT!;
const tableName = process.env.DYNAMODB_TEST_TABLE!;

const NOW = '2026-04-25T12:00:00.000Z';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/migrations',
);

const BACKFILL_ID = '20260101T0000';
const CAPITALIZE_ID = '20260102T0000';

let rawClient: DynamoDBClient;
let doc: DynamoDBDocumentClient;
let db: AppClient;

const readLedgerRow = async (id: string) => {
  const { Item } = await doc.send(
    new GetCommand({ TableName: tableName, Key: { PK: 'DB_MIGRATE', SK: id } }),
  );
  return Item;
};

/** Drop every row in the DB_MIGRATE partition so each test starts from a clean ledger. */
const clearLedger = async () => {
  const { Items = [] } = await doc.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'DB_MIGRATE' },
    }),
  );
  for (const item of Items) {
    await doc.send(
      new DeleteCommand({ TableName: tableName, Key: { PK: item.PK, SK: item.SK } }),
    );
  }
};

/** Seed a ledger row directly, as if a prior run had applied this migration. */
const seedApplied = async (id: string, name: string) => {
  await doc.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'DB_MIGRATE',
        SK: id,
        type: 'DB_MIGRATE', // pagedQuery filters on this discriminator
        name,
        checksum: 'seeded',
        status: 'applied',
      },
    }),
  );
};

beforeAll(() => {
  rawClient = new DynamoDBClient({
    endpoint,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  doc = DynamoDBDocumentClient.from(rawClient);
  db = makeUserClient(tableName, rawClient);
});

beforeEach(async () => {
  await clearLedger();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  rawClient.destroy();
});

describe('runMigrations', () => {
  it('applies pending migrations in order, records the ledger, and mutates data', async () => {
    await db.user.put(makeUser({ PK: 'USER#a', SK: 'USER#a', name: 'Ann' }));
    await db.user.put(makeUser({ PK: 'USER#b', SK: 'USER#b', name: 'Bob' }));

    const result = await runMigrations({
      client: db,
      tableName,
      dynamoClient: rawClient,
      migrationsDir,
    });

    // Applied in ascending timestamp order; nothing skipped on a first run.
    expect(result).toEqual({ applied: [BACKFILL_ID, CAPITALIZE_ID], skipped: [] });

    // Data was transformed: backfill set status, then capitalize upper-cased it.
    const ann = await db.user.get({ PK: 'USER#a', SK: 'USER#a' });
    const bob = await db.user.get({ PK: 'USER#b', SK: 'USER#b' });
    expect(ann?.status).toBe('ACTIVE');
    expect(bob?.status).toBe('ACTIVE');

    // A ledger row exists per applied migration with id, name, checksum, status.
    const backfillRow = await readLedgerRow(BACKFILL_ID);
    expect(backfillRow).toMatchObject({
      PK: 'DB_MIGRATE',
      SK: BACKFILL_ID,
      name: '20260101T0000__backfill-user-status.ts',
      status: 'applied',
    });
    expect(typeof backfillRow?.checksum).toBe('string');
    expect((backfillRow?.checksum as string).length).toBeGreaterThan(0);
  });

  it('skips already-applied migrations on a re-run and mutates nothing new', async () => {
    await db.user.put(makeUser({ PK: 'USER#c', SK: 'USER#c', name: 'Cara' }));

    await runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir });
    const afterFirst = await db.user.get({ PK: 'USER#c', SK: 'USER#c' });

    const result = await runMigrations({
      client: db,
      tableName,
      dynamoClient: rawClient,
      migrationsDir,
    });

    expect(result).toEqual({ applied: [], skipped: [BACKFILL_ID, CAPITALIZE_ID] });

    const afterSecond = await db.user.get({ PK: 'USER#c', SK: 'USER#c' });
    expect(afterSecond).toEqual(afterFirst);
  });

  it('keeps ledger rows out of users’ entity queries via the type discriminator', async () => {
    await db.user.put(makeUser({ PK: 'USER#d', SK: 'USER#d', name: 'Dee' }));
    await runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir });

    const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
    expect(users.every((u) => u.type === 'USER')).toBe(true);
  });

  describe('strict order', () => {
    const BACKFILL_NAME = '20260101T0000__backfill-user-status.ts';
    const CAPITALIZE_NAME = '20260102T0000__capitalize-status.ts';

    it('rejects a pending migration older than the newest applied, before applying anything', async () => {
      // Newer migration already applied, older one still pending — an out-of-order merge.
      await seedApplied(CAPITALIZE_ID, CAPITALIZE_NAME);

      const run = runMigrations({ client: db, tableName, dynamoClient: rawClient, migrationsDir });

      await expect(run).rejects.toBeInstanceOf(OutOfOrderError);
      await run.catch((error: OutOfOrderError) => {
        expect(error.migration.id).toBe(BACKFILL_ID);
        expect(error.newestApplied).toBe(CAPITALIZE_ID);
      });

      // Nothing was applied: the older migration left no ledger row.
      expect(await readLedgerRow(BACKFILL_ID)).toBeUndefined();
    });

    it('applies the out-of-order migration when allowOutOfOrder is set', async () => {
      await seedApplied(CAPITALIZE_ID, CAPITALIZE_NAME);

      const result = await runMigrations({
        client: db,
        tableName,
        dynamoClient: rawClient,
        migrationsDir,
        allowOutOfOrder: true,
      });

      expect(result.applied).toEqual([BACKFILL_ID]);
      expect(result.skipped).toContain(CAPITALIZE_ID);
      expect(await readLedgerRow(BACKFILL_ID)).toMatchObject({ status: 'applied' });
    });
  });
});
