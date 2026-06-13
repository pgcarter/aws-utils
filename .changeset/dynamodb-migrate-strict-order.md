---
'@bm8/aws-dynamodb-migrate': minor
---

`runMigrations` now enforces strict ordering: a pending migration older than the
newest already-applied one (an out-of-order merge) is rejected with the new
`OutOfOrderError` before anything is applied. Pass `allowOutOfOrder: true` (or
`strictOrder: false`) to permit it. Adds the `newestApplied` and `findOutOfOrder`
pure helpers.
