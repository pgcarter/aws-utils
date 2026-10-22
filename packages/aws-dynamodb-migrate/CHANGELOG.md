# @bm8/aws-dynamodb-migrate

## 0.2.0

### Minor Changes

- 0d5c825: `runMigrations` now verifies that already-applied migrations have not been edited
  since they ran. Each run re-hashes the on-disk source of every applied migration
  and compares it to the checksum recorded in the ledger when it was applied; a
  mismatch means the file and the data it produced have silently diverged. The new
  `onChecksumMismatch` option controls the reaction: `'warn'` (default) logs the
  mismatch through the logger and proceeds, while `'fail'` rejects with the new
  `ChecksumMismatchError` (identifying the migration and carrying both the expected
  and actual checksums). An unchanged migration triggers neither. The check is
  read-only, so it also runs under `dryRun`.
- 4f7599c: Adds the `dynamodb-migrate` CLI — a thin wrapper over the programmatic core,
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

- e5957f5: `runMigrations` gains two ergonomics options. `dryRun: true` reports the ordered
  set of migrations that _would_ run (returned in `applied`) but mutates nothing —
  no `up` is executed, no ledger row is written, and the lock is never taken, so a
  dry run is fully read-only and cannot interfere with a real run in progress (the
  same out-of-order / failed-row blocking checks still run, so it faithfully
  reports whether the run would proceed). `logger` is an injectable progress sink
  (`{ info, warn }`) with a silent no-op default (`noopLogger`), reporting which
  migrations are being applied, were applied, or skipped; the CLI will pass a
  console logger and a Lambda a structured one.
- 9c1b9a0: `runMigrations` now handles a migration failure: when an `up` throws it records a
  `status: 'failed'` ledger row, halts the line (no later migration runs), and
  rejects with the new `MigrationFailedError` carrying `{ migration, cause,
appliedBefore }`. A standing `failed` row blocks every subsequent run with the
  same error until a human repairs it. Adds the `repair({ id, mode })` core
  primitive: `retry` deletes the failed row (the migration reverts to pending and
  re-runs from the top — so every `up` MUST be idempotent), `resolve` flips it to
  `applied` (skipped forever).
- 8a8a303: `runMigrations` now takes a concurrency lock before applying anything: a single
  item written into the `DB_MIGRATE` partition with a conditional
  `attribute_not_exists` write. If another run already holds it, the run rejects
  immediately with the new `MigrationLockedError` (carrying the holding actor and
  acquisition time) rather than risk double-applying a migration. The lock is
  released in a `finally`, so it clears after a clean run, a failed migration, and
  an out-of-order reject alike. Adds the `forceUnlock({ tableName })` core
  primitive (returns whether a lock was present) to clear a stale lock left by a
  crashed run — the backing for a future `unlock --force` CLI command.
- 2ef701f: Add `@bm8/aws-dynamodb-migrate`: Flyway-style data migrations for DynamoDB. This
  first slice ships the programmatic core `runMigrations`, which discovers
  `<timestamp>__<description>.ts` migration modules, applies the pending ones in
  ascending order via the forwarded `@bm8/aws-dynamodb` client, records an
  `applied` ledger row (with checksum) per migration in the `DB_MIGRATE`
  partition, and resolves to `{ applied, skipped }`.
- faf5c3e: `runMigrations` now enforces strict ordering: a pending migration older than the
  newest already-applied one (an out-of-order merge) is rejected with the new
  `OutOfOrderError` before anything is applied. Pass `allowOutOfOrder: true` (or
  `strictOrder: false`) to permit it. Adds the `newestApplied` and `findOutOfOrder`
  pure helpers.

### Patch Changes

- cc22fcb: Adds user-facing documentation: a package `README` (in the style of the other
  `@bm8/aws-*` packages, linked from the root packages table) and an authoring
  guide.

  The README covers what the tool is and isn't (ordered run-once _data_
  migrations, never table/index structure; indexed `pagedQuery` only, no `Scan`;
  forward-only), the `up({ db })` authoring contract, configuration, the full CLI
  surface, the programmatic core, the `{ applied, skipped }` / typed-error
  contract, the operational model (ledger, lock, repair, unlock, status, dry-run,
  checksum verification), and both runtime modes — including the Lambda
  requirement to pre-compile migrations and package the migrations directory as
  on-disk assets.

  The authoring guide (`docs/authoring.md`) documents the filename convention,
  the named-`up` contract, the load-bearing idempotency requirement,
  immutability-once-applied, and the "no enumerating index ⇒ unreachable, by
  design" constraint, with a worked idempotent example.

  - @bm8/aws-dynamodb@0.2.0
