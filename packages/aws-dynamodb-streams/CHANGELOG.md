# @bm8/aws-dynamodb-streams

## 0.2.0

### Patch Changes

- @bm8/aws-dynamodb@0.2.0

## 0.1.0

### Minor Changes

- 13148a6: Initial public release.

  - `@bm8/aws-dynamodb`: single-table DynamoDB client with typed entities, GSI support, and paginated queries (`put`, `get`, `update`, `upsert`, `pagedQuery`).
  - `@bm8/aws-dynamodb-streams`: typed DynamoDB Streams record processor with per-`(eventName, entityName)` handlers, `batchItemFailures` reporting, and a `toLambdaHandler` adapter.
  - `@bm8/aws-core`: placeholder for shared utilities used across the suite.

### Patch Changes

- Updated dependencies [13148a6]
  - @bm8/aws-dynamodb@0.1.0
