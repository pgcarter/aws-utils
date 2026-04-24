import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';

const PORT = 8765;
const HOST = '127.0.0.1';
const PROJECT = 'aws-utils-dynamodb-test';

const composeDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_ENDPOINT = `http://${HOST}:${PORT}`;
export const TEST_TABLE = 'test-table';

const compose = (...args: string[]) => {
  const result = spawnSync(
    'docker',
    ['compose', '-p', PROJECT, '-f', 'docker-compose.yml', ...args],
    { cwd: composeDir, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed with status ${result.status}`);
  }
};

const makeClient = () =>
  new DynamoDBClient({
    endpoint: TEST_ENDPOINT,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    maxAttempts: 1,
  });

const waitForReady = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const client = makeClient();
    try {
      await client.send(new ListTablesCommand({}));
      client.destroy();
      return;
    } catch {
      client.destroy();
      await delay(250);
    }
  }
  throw new Error(`dynamodb-local did not become ready at ${TEST_ENDPOINT}`);
};

const createTable = async () => {
  const client = makeClient();

  try {
    await client.send(
      new CreateTableCommand({
        TableName: TEST_TABLE,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
          { AttributeName: 'GSI1PK', AttributeType: 'S' },
          { AttributeName: 'GSI1SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) throw error;
    // Table already exists from a prior run — drop and recreate for isolation.
    await client.send(new DeleteTableCommand({ TableName: TEST_TABLE }));
    await createTable();
  } finally {
    client.destroy();
  }
};

export default async function setup() {
  compose('up', '-d');
  await waitForReady();
  await createTable();

  process.env.DYNAMODB_TEST_ENDPOINT = TEST_ENDPOINT;
  process.env.DYNAMODB_TEST_TABLE = TEST_TABLE;

  return async () => {
    compose('down', '-v');
  };
}
