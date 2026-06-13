---
'@bm8/aws-dynamodb-migrate': minor
---

`runMigrations` now handles a migration failure: when an `up` throws it records a
`status: 'failed'` ledger row, halts the line (no later migration runs), and
rejects with the new `MigrationFailedError` carrying `{ migration, cause,
appliedBefore }`. A standing `failed` row blocks every subsequent run with the
same error until a human repairs it. Adds the `repair({ id, mode })` core
primitive: `retry` deletes the failed row (the migration reverts to pending and
re-runs from the top — so every `up` MUST be idempotent), `resolve` flips it to
`applied` (skipped forever).
