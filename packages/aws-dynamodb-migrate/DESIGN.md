# @bm8/aws-dynamodb-migrate — Design

Flyway-style **data** migrations for DynamoDB: ordered, run-once transformations of existing item data in a table. Programmatic core first, thin CLI on top. See [CONTEXT.md](./CONTEXT.md) for vocabulary and [docs/adr/](./docs/adr/) for the load-bearing decisions.

## What it is (and isn't)

- A **migration** is a one-time, ordered transformation of item *data*, authored as a TypeScript module exporting `up`. It is **never** a change to table/index *structure* — that stays in CDK/CloudFormation.
- Reaches data **only** through indexed `pagedQuery` calls on the typed `@bm8/aws-dynamodb` client. **No `Scan`, no raw-SDK escape hatch** ([ADR-0001](./docs/adr/0001-indexed-queries-only-no-scan.md)). An entity unreachable by an index is unreachable by a migration, by design.
- **Forward-only.** Modules export `up` and nothing else; there is no `down`. A wrong migration is fixed by shipping a new one.

## Authoring a migration

```ts
// migrations/20260613T1430__backfill-user-status.ts
export const up = async ({ db }) => {
  const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
  for (const u of users) {
    if (u.status === undefined) {
      await db.user.update({ PK: u.PK, SK: u.SK }, { status: 'active' });
    }
  }
};
```

- **Filename is the source of truth** for identity and order: `<timestamp>__<description>.ts`, e.g. `20260613T1430__backfill-user-status.ts`. Timestamp prefix → collision-free across branches, naturally ordered.
- **`export const up`** (named, not default) — leaves room for future per-migration metadata exports without a breaking change.
- `up` receives **`{ db }`** only — the user's `createDynamoClient` instance. Bulk changes are **per-item `db.entity.update(...)` loops** over `pagedQuery` results (keeps audit fields + `type` safety; no `BatchWrite` reimplementation).
- **`up` MUST be idempotent.** A failed run is retried *from the top*, re-processing already-transformed items, so re-applying an item must be a no-op. This is a documented, load-bearing contract the framework cannot enforce.

## The ledger

A run is made ordered and run-once by the **ledger**: items in the target table's `DB_MIGRATE` partition, modelled as an internal `@bm8/aws-dynamodb` entity (dogfoods the typed client; audit fields record who ran each migration, when).

```ts
type LedgerAttrs = {
  PK: 'DB_MIGRATE';
  SK: `<timestamp>`;            // the migration id
  name: string;                // human filename
  checksum: string;            // hash of source bytes at apply time
  status: 'applied' | 'failed';
};
```

- **Same table** as application data (single-table). The `type` discriminator keeps ledger rows out of users' entity queries.
- **Discovery / pending set:** read `migrationsDir`, sort by filename; pending = on disk − ledger.
- **Strict order by default:** apply in ascending timestamp order; **fail** if a pending migration is older than the newest already-applied one (`allowOutOfOrder` opt-out).
- **Checksum:** source bytes hashed at apply time and re-checked on later runs. Mismatch = a migration was edited after being applied. **Warns by default**, `onChecksumMismatch: 'fail'` escalates. Enforces "immutable once applied."

## Failure model

No transactions: `up` is a loop of independent writes, so a throw mid-loop leaves partial, permanent writes.

- On failure, a **`status: 'failed'` ledger row is written and the line halts** — no further migrations run until a human intervenes. Prevents blind double-apply of a half-done migration.
- **Repair** is human-initiated only, two modes:
  - **retry** — delete the failed row; migration reverts to pending and re-runs from the top (relies on idempotency).
  - **resolve** — flip the row to `applied`; migration is skipped forever (data was fixed by hand / deemed fine).
  - The tool never repairs automatically.

## Concurrency

- Before running, take a **lock**: a single item in the `DB_MIGRATE` partition written with a conditional `attribute_not_exists` check. If the write fails, another run holds it.
- Released in a `finally`. A dead process leaves a stale lock carrying actor/timestamp, cleared by a human via `unlock --force`.

## Programmatic core

```ts
const result = await runMigrations({
  client,                       // user's createDynamoClient — forwarded to up({ db })
  tableName,                    // + dynamoClient? — used to stand up our own internal ledger client on the same table
  dynamoClient,                 // optional raw DynamoDBClient for region/creds/endpoint
  migrationsDir,                // absolute path; core does import(filePath), loader-agnostic
  strictOrder = true,
  allowOutOfOrder = false,
  onChecksumMismatch = 'warn',  // 'warn' | 'fail'
  dryRun = false,
  logger,                       // injectable; no-op default
});
```

- **`client` is forwarded to `up`; `tableName` (+ optional raw client) lets the core build its *own* internal ledger client** against the same table. Separates "client migrations use" from "how the ledger is persisted."
- **Returns `{ applied, skipped }` on a clean run only.** Every blocking condition is a **distinct typed error** (never a field on a success value):
  - `MigrationFailedError` — `{ migration, cause, appliedBefore }`
  - `MigrationLockedError` — another run holds the lock
  - `ChecksumMismatchError` — only when `onChecksumMismatch: 'fail'`
  - `OutOfOrderError` — pending migration older than newest applied, in strict mode
- Rule: **resolve = everything that needed to run, ran; reject = it stopped, here's where and why.** A caller never inspects a success value to find a hidden failure.
- **`dryRun`** reports *which* migrations would run; it cannot simulate what each `up` would do to the data.

## Loader strategy (two runtime modes)

The core only ever does `import(filePath)` and **bundles no transpiler** ([ADR-0002](./docs/adr/0002-loader-agnostic-core-two-runtime-modes.md)):

- **CLI / local / CI:** run under `tsx`, point `migrationsDir` at `.ts` sources.
- **Lambda-on-deploy (supported in v1):** pre-compile migrations to `.js`, package the migrations dir as Lambda **assets** (on disk in the zip, *not* bundled code — a bundler won't see runtime-discovered files), point `migrationsDir` at the compiled dir. Plain Node `import()` resolves them, no `tsx`.

## CLI surface

Thin wrapper over the core (built second). All five ship in v1:

| Command | Purpose |
| --- | --- |
| `up` | Run all pending migrations. The deploy verb. Supports `--dry-run`. |
| `status` | List each migration as applied / pending / failed, and whether the lock is held. Read-only. |
| `new <description>` | Scaffold `<timestamp>__<description>.ts` from a template (prevents malformed timestamps). |
| `repair <id> --retry \| --resolve` | Clear a failed ledger row (retry = delete, resolve = mark applied). |
| `unlock --force` | Clear a stale lock left by a dead run. |

## Packaging

- `@bm8/aws-dynamodb-migrate`, ESM, Node ≥24, tsup-built, vitest + `dynamodb-local` for integration tests — matches the rest of the workspace.
- Depends on `@bm8/aws-dynamodb` (`workspace:*`). Adds a `bin` for the CLI.
- Lockstep-versioned with the other `@bm8/aws-*` packages via Changesets.

## Deliberately out of scope for v1

- `Scan` / full-table iteration and any raw-SDK escape hatch (ADR-0001).
- `down` / rollback / reversible migrations.
- `BatchWrite` bulk helpers (per-item updates only).
- Bundled transpiler / on-the-fly `.ts` loading in the core (ADR-0002).
- Benign no-op on lock contention (it throws for now).
