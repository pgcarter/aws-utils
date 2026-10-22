---
'@bm8/aws-dynamodb-migrate': minor
---

`runMigrations` gains two ergonomics options. `dryRun: true` reports the ordered
set of migrations that *would* run (returned in `applied`) but mutates nothing —
no `up` is executed, no ledger row is written, and the lock is never taken, so a
dry run is fully read-only and cannot interfere with a real run in progress (the
same out-of-order / failed-row blocking checks still run, so it faithfully
reports whether the run would proceed). `logger` is an injectable progress sink
(`{ info, warn }`) with a silent no-op default (`noopLogger`), reporting which
migrations are being applied, were applied, or skipped; the CLI will pass a
console logger and a Lambda a structured one.
