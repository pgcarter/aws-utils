# @bm8/aws-dynamodb-migrate

Flyway-style, ordered, run-once **data** migrations for single-table DynamoDB designs built with [`@bm8/aws-dynamodb`](../aws-dynamodb). You author each migration as a TypeScript module exporting a named `up`; the tool records what has run in a **ledger** inside your own table, applies only the pending migrations in timestamp order, refuses to run two at once, verifies applied migrations have not been edited, and halts loudly when one fails so a human can decide what to do.

Ships a programmatic **core** (`runMigrations`) with a thin **CLI** on top. The same core runs locally/in CI under `tsx` and wrapped in a Lambda on deploy.

## Install

```sh
pnpm add @bm8/aws-dynamodb-migrate
```

## What it is — and isn't

- **Data, not schema.** It transforms the *items* already in your table (back-populating a new attribute, re-encoding a value, seeding a new GSI). Table and index *structure* stays in CDK/CloudFormation — this tool never touches it.
- **Indexed queries only, no `Scan`.** A migration reaches data exclusively through indexed `pagedQuery` calls on your typed client and changes it with per-item `update`s. There is no `Scan`, no raw-SDK escape hatch ([ADR-0001](./docs/adr/0001-indexed-queries-only-no-scan.md)).
- **Forward-only.** Migrations have an `up` and no `down`. DynamoDB data changes cannot be faithfully reversed, so rollback is deliberately absent.
- **No enumerating index ⇒ unreachable, by design.** If an entity has no GSI partition that enumerates its items, a migration cannot find them — and that is intentional, not a gap. Model a "list-all-of-type" index before relying on this tool, rather than reaching for a `Scan`.

## Authoring a migration

A migration is a file named `<timestamp>__<description>.ts` exporting a named `up`:

```ts
// 20260613T1430__backfill-user-status.ts
//
// IMPORTANT: `up` MUST be idempotent (see below).
export const up = async ({ db }) => {
  const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
  for (const user of users) {
    if (user.status !== undefined) continue; // already migrated → no-op
    await db.user.update({ PK: user.PK, SK: user.SK }, { status: 'active' });
  }
};
```

- **Filename is identity and ordering.** The `<timestamp>` prefix (`YYYYMMDDThhmm`, UTC) is the migration's id and sort key. Use `new <description>` to scaffold it rather than hand-typing a timestamp that could break ordering.
- **`up({ db })`.** `db` is your `createDynamoClient` instance, forwarded unchanged — full type-safety and automatic audit fields. It's a named export (not `default`), leaving room for future per-migration metadata exports.
- **`up` MUST be idempotent.** A failed run is retried *from the top* over items that may already be half-transformed, so re-processing an already-migrated item must be a safe no-op. The framework cannot enforce this — guard every write on whether it has already been applied. The `new` scaffold leads with this reminder.

See the [authoring guide](./docs/authoring.md) for a fuller walkthrough.

## Configuration

The CLI reads `dynamodb-migrate.config.{ts,js,mjs}` from the working directory (or `--config <path>`), exporting an object with your typed client, table name and migrations directory:

```ts
// dynamodb-migrate.config.ts
import { createDynamoClient } from '@bm8/aws-dynamodb';
import { entities } from './src/entities';

export default {
  client: createDynamoClient({ tableName: 'my-table', entities }),
  tableName: 'my-table',
  migrationsDir: './migrations', // resolved relative to this config file
};
```

`migrationsDir` is resolved relative to the config file, so it does not depend on where the CLI is run from. An optional `dynamoClient` (a raw `DynamoDBClient`) can carry region/creds/endpoint for the internal ledger and lock clients.

## CLI

```sh
dynamodb-migrate up [--dry-run]          # apply all pending migrations (--dry-run reports only)
dynamodb-migrate status                  # list every migration's state and whether the lock is held
dynamodb-migrate new <description>       # scaffold a new <timestamp>__<description>.ts migration
dynamodb-migrate repair <id> --retry     # re-run a failed migration from the top
dynamodb-migrate repair <id> --resolve   # mark a failed migration applied (skip it forever)
dynamodb-migrate unlock --force          # clear a stale lock left by a crashed run
```

Run it under `tsx` so it can load `.ts` config and migration sources directly:

```sh
tsx node_modules/.bin/dynamodb-migrate up
```

## Programmatic core

The CLI is a thin wrapper; you can call the core directly (for example, from a Lambda):

```ts
import { runMigrations } from '@bm8/aws-dynamodb-migrate';

const { applied, skipped } = await runMigrations({
  client,                 // your typed @bm8/aws-dynamodb client, forwarded to each up({ db })
  tableName: 'my-table',  // the table the ledger and lock live in
  migrationsDir: '/var/task/migrations',
  dynamoClient,           // optional raw DynamoDBClient for region/creds/endpoint
  // strictOrder: true,             // reject an out-of-order pending migration (default)
  // allowOutOfOrder: false,        // opt out of strict ordering
  // onChecksumMismatch: 'warn',    // 'warn' (default) | 'fail'
  // dryRun: false,                 // report would-run set, mutate nothing
  // logger,                        // injectable { info, warn }; default is silent
});
```

`runMigrations` resolves to a structured summary on a clean run and **throws** on every blocking condition (see the error contract below).

### Return / error contract

On a clean run, `runMigrations` resolves to `{ applied, skipped }` — there is never a `failed` field on the success value:

```ts
interface MigrationSummary {
  applied: string[]; // ids applied this run, ascending (under dryRun, the ids that *would* run)
  skipped: string[]; // ids already in the ledger and therefore skipped
}
```

> **Rule:** resolve = everything that needed to run ran; reject = it stopped, here's where and why. Your CI step exits non-zero on a throw and never has to inspect a success value to discover a hidden failure.

Every blocking condition throws a **distinct typed error**, so callers can catch the case they care about:

| Error                   | Thrown when                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `MigrationFailedError`  | A migration's `up` threw — or a prior `failed` row still blocks the line. Carries `{ migration, cause, appliedBefore }`. |
| `MigrationLockedError`  | Another run already holds the lock. Carries `{ heldBy?, acquiredAt? }`.                                 |
| `OutOfOrderError`       | Strict mode, and a pending migration is older than the newest applied one. Carries `{ migration, newestApplied }`. |
| `ChecksumMismatchError` | `onChecksumMismatch: 'fail'`, and an applied migration's source was edited since it ran. Carries `{ migration, expected, actual }`. |

## Operations

- **Ledger.** Every applied/failed migration is recorded as a row in your table's `DB_MIGRATE` partition (a `name`, a `checksum` of the source at apply time, and a `status`). It's modelled as an internal `@bm8/aws-dynamodb` entity, so its `type` discriminator keeps ledger rows out of your own entity queries — no extra infrastructure.
- **Lock.** Before applying anything, a single lock item is taken in the `DB_MIGRATE` partition via a conditional `attribute_not_exists` write and released in a `finally` — so it clears after a clean run, a failed migration, and an out-of-order reject alike. A concurrent run throws `MigrationLockedError` rather than risk a double-apply.
- **Failure & repair.** No transactions: an `up` is a loop of independent writes, so a throw mid-loop leaves partial permanent writes. On failure the tool writes a `failed` ledger row and halts the whole line; that row blocks every later run until a human repairs it. `repair <id> --retry` deletes the row (reverts to pending, re-runs from the top — relying on idempotency); `repair <id> --resolve` flips it to applied (skipped forever) after you fix the data by hand. The tool never repairs automatically.
- **Unlock.** A run that crashed leaves a stale lock; `unlock --force` clears it unconditionally.
- **Status.** `status` is read-only: it lists every migration (the union of on-disk and ledger ids) as `applied` / `pending` / `failed`, and reports whether the lock is held and by whom.
- **Dry run.** `up --dry-run` reports which migrations *would* run, in order, but mutates nothing — it never takes the lock and writes no ledger rows. It still runs the failed-row and out-of-order checks, so it faithfully reports whether the run would proceed. It cannot simulate what each `up` would do to your data.
- **Checksum verification.** On every run, each already-applied migration's on-disk source is re-hashed and compared to the checksum recorded when it ran. A mismatch means the file was edited after it was applied — its source and the data it produced have diverged. `onChecksumMismatch: 'warn'` (default) logs and proceeds; `'fail'` throws `ChecksumMismatchError`.

## Runtime modes

The core only ever does `import(filePath)` and bundles no transpiler ([ADR-0002](./docs/adr/0002-loader-agnostic-core-two-runtime-modes.md)), so the same engine works under two loaders:

### 1. Local / CI — under `tsx`, pointing at `.ts` sources

Run the CLI under `tsx`; the dynamic `import` resolves your `.ts` migration and config files directly. This is the everyday authoring and deploy-from-CI path.

### 2. Lambda on deploy — pre-compiled `.js`, packaged as assets

To run migrations automatically as part of a pipeline, wrap `runMigrations` in a Lambda. Two requirements:

- **Pre-compile migrations to `.js`.** A Lambda runtime has no `tsx`; compile your `migrations/` directory to JavaScript and point `migrationsDir` at the compiled output.
- **Package the migrations directory as Lambda _assets_** — on disk in the zip, **not** bundled into your handler code. A bundler cannot see runtime-discovered files (the core `readdir`s the directory and `import`s whatever it finds), so the compiled `.js` files must be present on disk at the path `migrationsDir` points to (e.g. `/var/task/migrations`).

Both modes are supported in v1; the Lambda requirement is documented, not enforced.

## See also

- [`@bm8/aws-dynamodb`](../aws-dynamodb) — the typed entity client a migration's `up({ db })` receives.
- [Authoring guide](./docs/authoring.md) — filename convention, the `up` contract, idempotency, and a worked example.
- [ADR-0001](./docs/adr/0001-indexed-queries-only-no-scan.md) — indexed queries only, no `Scan`.
- [ADR-0002](./docs/adr/0002-loader-agnostic-core-two-runtime-modes.md) — loader-agnostic core, two runtime modes.
