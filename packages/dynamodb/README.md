# @bewdym8/dynamodb

A small, type-safe wrapper around `@aws-sdk/lib-dynamodb` for single-table DynamoDB designs. You declare your entities once with `defineEntity`, then `createDynamoClient` returns a per-entity client where `put`/`get`/`update`/`upsert`/`pagedQuery` are typed against the entity's attributes and indexes.

## Install

```sh
pnpm add @bewdym8/dynamodb
```

## Concepts

- **Single table.** All entities live in one table keyed by `PK` / `SK`.
- **Type discriminator.** Every item carries a `type` attribute set from the entity definition. Queries automatically filter by `type`, so a `pagedQuery` on the `user` entity will not return `order` items that happen to share a partition.
- **GSIs.** Supported index names are `GSI1` and `GSI2`. Declaring an index on an entity surfaces `GSI1PK` / `GSI1SK` (etc.) as typed attributes you can write and query against.

## Defining entities

```ts
import { defineEntity, type Entity } from '@bewdym8/dynamodb';

type UserAttrs = {
  PK: `USER#${string}`;
  SK: `USER#${string}`;
  GSI1PK?: 'USERS';
  GSI1SK?: string;
  name: string;
  email: string;
};

export const userEntity = defineEntity<'USER', UserAttrs, ['GSI1']>(
  'USER',
  { indexes: ['GSI1'] },
);

type OrderAttrs = {
  PK: `USER#${string}`;
  SK: `ORDER#${string}`;
  total: number;
};

export const orderEntity = defineEntity<'ORDER', OrderAttrs>('ORDER');

export const entities = { user: userEntity, order: orderEntity };
```

The first generic must be uppercase — the type tag is enforced as `Uppercase<TType>`.

## Creating the client

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createDynamoClient } from '@bewdym8/dynamodb';
import { entities } from './entities';

const db = createDynamoClient({
  tableName: 'app-table',
  entities,
  // optional: pass your own DynamoDBClient (region, endpoint, credentials, etc.)
  client: new DynamoDBClient({}),
});
```

`db` is shaped as `{ user: EntityOperations, order: EntityOperations }`, one entry per key in `entities`.

## Operations

### `put(entity)`

Writes the full item. The `type` attribute is set automatically from the entity definition; any value you pass for `type` is overwritten.

```ts
await db.user.put({
  PK: 'USER#1',
  SK: 'USER#1',
  GSI1PK: 'USERS',
  GSI1SK: 'alice',
  name: 'Alice',
  email: 'alice@example.com',
});
```

### `get(key)`

Reads by primary key. Returns `undefined` if the item does not exist.

```ts
const user = await db.user.get({ PK: 'USER#1', SK: 'USER#1' });
```

### `update(key, patch, remove?)`

Sets the attributes in `patch` and removes the attributes listed in `remove`. Fails if the item does not exist (`attribute_exists(PK)`). The `type` attribute cannot be updated.

```ts
await db.user.update(
  { PK: 'USER#1', SK: 'USER#1' },
  { name: 'Alice B.', GSI1SK: 'alice b.' },
);

// remove optional attributes
await db.user.update(
  { PK: 'USER#1', SK: 'USER#1' },
  {},
  ['GSI1PK', 'GSI1SK'],
);
```

Only attributes typed as optional on the entity are accepted in the `remove` list.

### `upsert(key, patch)`

Like `update`, but creates the item if it does not exist. Sets `type` on insert.

```ts
await db.user.upsert(
  { PK: 'USER#2', SK: 'USER#2' },
  { name: 'Bob', email: 'bob@example.com' },
);
```

### `pagedQuery(params)`

Queries the base table or a GSI, paginating through `LastEvaluatedKey` and returning the accumulated results. A `type` filter is always applied so cross-entity items in the same partition are excluded.

```ts
// base table — all orders for a user
const orders = await db.order.pagedQuery({
  pk: 'USER#1',
  sk: { beginsWith: 'ORDER#' },
});

// GSI1 — first 50 users alphabetically
const users = await db.user.pagedQuery({
  index: 'GSI1',
  pk: 'USERS',
  sk: { between: ['a', 'm'] },
  limit: 50,
});
```

`sk` accepts one of:

```ts
{ equals: string }
{ beginsWith: string }
{ between: [string, string] }
{ lt: string } | { lte: string } | { gt: string } | { gte: string }
```

`limit` caps the in-memory result count; pagination stops as soon as that many items have been collected.

## Testing

The package's tests run against [`amazon/dynamodb-local`](./docker-compose.yml). With the container up:

```sh
pnpm --filter @bewdym8/dynamodb test
```
