---
"@bm8/aws-core": minor
"@bm8/aws-dynamodb": minor
"@bm8/aws-dynamodb-streams": minor
---

Initial public release.

- `@bm8/aws-dynamodb`: single-table DynamoDB client with typed entities, GSI support, and paginated queries (`put`, `get`, `update`, `upsert`, `pagedQuery`).
- `@bm8/aws-dynamodb-streams`: typed DynamoDB Streams record processor with per-`(eventName, entityName)` handlers, `batchItemFailures` reporting, and a `toLambdaHandler` adapter.
- `@bm8/aws-core`: placeholder for shared utilities used across the suite.
