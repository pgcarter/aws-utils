# @bm8/aws-dynamodb-streams

A typed DynamoDB Streams record processor for entities defined with [`@bm8/aws-dynamodb`](../aws-dynamodb). Register handlers per `(eventName, entityName)`; the processor unmarshalls images, dispatches to the right handler with a typed entity, preserves per-shard ordering, and reports per-record failures via `batchItemFailures`.

## Install

```sh
pnpm add @bm8/aws-dynamodb-streams
```

## Quickstart

```ts
import { createStreamProcessor } from '@bm8/aws-dynamodb-streams';
import { entities } from './entities'; // same map you pass to createDynamoClient

const processor = createStreamProcessor({ entities })
  .on('INSERT', 'user', async ({ entity, key, eventID }) => {
    // entity is fully typed against the user EntityDefinition
  })
  .on('MODIFY', 'user', async ({ oldEntity, newEntity }) => {})
  .on('REMOVE', 'user', async ({ entity }) => {});

// Share one handler across events — arg is typed as the union of per-event args.
createStreamProcessor({ entities }).on(['INSERT', 'MODIFY'], 'user', async (arg) => {
  if ('oldEntity' in arg) {
    /* MODIFY */
  } else {
    /* INSERT */
  }
});

// Pass the records straight off your stream batch.
const { batchItemFailures } = await processor.process(records);
```

## Lambda

Wrap a processor with `toLambdaHandler` to get a Lambda-shaped function. Configure your event source mapping with `ReportBatchItemFailures` so DynamoDB Streams retries only the failed records.

```ts
import { createStreamProcessor, toLambdaHandler } from '@bm8/aws-dynamodb-streams';
import { entities } from './entities';

const processor = createStreamProcessor({ entities }).on(
  'INSERT',
  'user',
  async ({ entity }) => {},
);

export const handler = toLambdaHandler(processor);
```

The adapter is the only place this package touches Lambda types — install `@types/aws-lambda` if you use it; non-Lambda consumers can skip it (it's an optional peer dependency).

## Required table configuration

The processor assumes the table's stream is configured with `StreamViewType: NEW_AND_OLD_IMAGES`. Any other view type causes `.process()` to throw with a directly actionable message — `INSERT` needs `NewImage`, `REMOVE` needs `OldImage`, and `MODIFY` needs both.

## Delivery semantics and idempotency

DynamoDB Streams is **at-least-once**: a given record can be delivered to your handler more than once (after a Lambda retry, a shard re-read, etc.). This package does not deduplicate. Handlers must be idempotent — for example, by writing with conditional expressions, by upserting on a stable key derived from the record, or by gating on a downstream version number.

## Error contract

| Situation                                               | Behavior                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Record has no `type` attribute                          | Silently skipped (treated as a legacy or non-entity row).                |
| Record's `type` is not in the `entities` map            | `.process()` throws — treated as deploy skew, retry will not help.       |
| Required image is missing (wrong `StreamViewType`)      | `.process()` throws with a `NEW_AND_OLD_IMAGES` hint.                    |
| Duplicate `.on(event, entityName, ...)` registration    | Throws synchronously at registration time, naming the conflicting cell.  |
| `(event, entityName)` has no registered handler         | Silently skipped — opt into the events you care about.                   |
| Handler rejects                                         | Recorded in `batchItemFailures` by `SequenceNumber`; remainder continues.|

When a handler rejects, return the result from your Lambda configured with `ReportBatchItemFailures` so DynamoDB Streams retries only the failed records.

## See also

- [`@bm8/aws-dynamodb`](../aws-dynamodb) — the source of `EntityDefinition` and the shared `entities` map.
