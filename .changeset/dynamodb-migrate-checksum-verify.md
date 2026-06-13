---
'@bm8/aws-dynamodb-migrate': minor
---

`runMigrations` now verifies that already-applied migrations have not been edited
since they ran. Each run re-hashes the on-disk source of every applied migration
and compares it to the checksum recorded in the ledger when it was applied; a
mismatch means the file and the data it produced have silently diverged. The new
`onChecksumMismatch` option controls the reaction: `'warn'` (default) logs the
mismatch through the logger and proceeds, while `'fail'` rejects with the new
`ChecksumMismatchError` (identifying the migration and carrying both the expected
and actual checksums). An unchanged migration triggers neither. The check is
read-only, so it also runs under `dryRun`.
