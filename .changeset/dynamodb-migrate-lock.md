---
'@bm8/aws-dynamodb-migrate': minor
---

`runMigrations` now takes a concurrency lock before applying anything: a single
item written into the `DB_MIGRATE` partition with a conditional
`attribute_not_exists` write. If another run already holds it, the run rejects
immediately with the new `MigrationLockedError` (carrying the holding actor and
acquisition time) rather than risk double-applying a migration. The lock is
released in a `finally`, so it clears after a clean run, a failed migration, and
an out-of-order reject alike. Adds the `forceUnlock({ tableName })` core
primitive (returns whether a lock was present) to clear a stale lock left by a
crashed run — the backing for a future `unlock --force` CLI command.
