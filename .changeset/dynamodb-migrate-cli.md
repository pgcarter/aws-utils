---
'@bm8/aws-dynamodb-migrate': minor
---

Adds the `dynamodb-migrate` CLI — a thin wrapper over the programmatic core,
exposed via a `bin`. Each command parses its arguments and calls the
corresponding core capability with a console logger, doing no orchestration of
its own:

- `up [--dry-run]` — apply all pending migrations (`--dry-run` reports without mutating).
- `status` — list every migration as applied / pending / failed and whether the lock is held (read-only).
- `new <description>` — scaffold a correctly-named `<timestamp>__<description>.ts` migration with a named `up` stub and an idempotency reminder.
- `repair <id> --retry|--resolve` — map to the core repair modes.
- `unlock --force` — clear a stale lock via the core force-unlock primitive.

Also adds a `status({ tableName, migrationsDir })` core primitive returning a
read-only `{ migrations, lock }` snapshot (the union of on-disk and ledger
migrations classified by state, plus lock holder), backing the `status` command.
Configuration is loaded from `dynamodb-migrate.config.{ts,js,mjs}` (or
`--config <path>`), exporting `{ client, tableName, migrationsDir }`.
