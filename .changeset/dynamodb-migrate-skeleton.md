---
'@bm8/aws-dynamodb-migrate': minor
---

Add `@bm8/aws-dynamodb-migrate`: Flyway-style data migrations for DynamoDB. This
first slice ships the programmatic core `runMigrations`, which discovers
`<timestamp>__<description>.ts` migration modules, applies the pending ones in
ascending order via the forwarded `@bm8/aws-dynamodb` client, records an
`applied` ledger row (with checksum) per migration in the `DB_MIGRATE`
partition, and resolves to `{ applied, skipped }`.
