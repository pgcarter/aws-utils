# Authoring a migration

This guide covers how to write a migration that the tool can discover, order, and run safely. For the operational side (running, repairing, the error contract) see the [README](../README.md).

## Filename convention

A migration is a file in your `migrationsDir` named:

```
<timestamp>__<description>.ts
```

- `<timestamp>` is `YYYYMMDDThhmm` in **UTC** — for example `20260613T1430`. This prefix is the migration's **id** and its **sort key**: the tool applies migrations in ascending timestamp order, and records that id in the ledger.
- `__` (a double underscore) separates the timestamp from the human-readable description.
- `<description>` is a slug (lowercase, hyphen-separated) describing what the migration does.

The filename is the **single source of truth** for identity and ordering. Two developers branching at once get distinct timestamps, so they don't collide on a shared version number the way a sequential integer would.

**Generate it, don't hand-type it.** A malformed timestamp breaks ordering silently. Use the scaffold:

```sh
dynamodb-migrate new "backfill user status"
# → creates migrations/20260613T1430__backfill-user-status.ts
```

## The `up` contract

A migration exports a **named** `up` (not a `default` export — leaving room for future per-migration metadata exports):

```ts
export const up = async ({ db }) => {
  // ...
};
```

`up` receives a single context object `{ db }`, where `db` is your `createDynamoClient` instance, forwarded **unchanged**. You read and write items with the same typed entity client you use in your app — full type-safety, and audit fields populated automatically.

There is no `down`. Migrations are forward-only.

## Reaching data: indexed queries only

A migration finds items through indexed `pagedQuery` calls and changes them with per-item `update`s. There is **no `Scan`** and no raw-SDK escape hatch ([ADR-0001](./adr/0001-indexed-queries-only-no-scan.md)) — this keeps migrations targeted and cheap, and avoids the capacity risk of a full-table scan on a large production table.

```ts
export const up = async ({ db }) => {
  const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
  for (const user of users) {
    await db.user.update({ PK: user.PK, SK: user.SK }, { status: 'active' });
  }
};
```

### No enumerating index ⇒ unreachable, by design

If the entity you want to migrate has **no GSI partition that enumerates its items**, a migration cannot find them — there is no query that returns "all users". This is intentional. Rather than reaching for a `Scan`, model a "list-all-of-type" index (a GSI whose partition key is a constant for every item of that type) **before** you rely on this tool. An entity that needs migrating should already carry such an index.

## Idempotency — the load-bearing requirement

**Every `up` MUST be idempotent.**

DynamoDB has no transactions, so an `up` is a loop of independent writes. If it throws partway through, the writes it already made are permanent. When you `repair --retry`, the migration re-runs **from the top** — over items that may already be half-transformed. Re-processing an already-migrated item must therefore be a safe **no-op**.

The framework cannot enforce this; it's a discipline you encode in the migration. Guard every write on whether it has already been applied:

```ts
export const up = async ({ db }) => {
  const users = await db.user.pagedQuery({ index: 'GSI1', pk: 'USERS' });
  for (const user of users) {
    if (user.status !== undefined) continue; // already migrated → skip
    await db.user.update({ PK: user.PK, SK: user.SK }, { status: 'active' });
  }
};
```

Common idempotency strategies:

- **Gate on the target state.** Skip items that already have the new attribute / new encoding (as above).
- **Conditional writes.** Write with a condition that only succeeds if the change hasn't been applied yet.
- **Derive deterministically.** Make the transformation a pure function of the existing item, so re-running produces the identical result.

If a retried migration would double-count, corrupt, or duplicate when it re-processes an already-migrated item, the migration is **not** idempotent and must be rewritten before it's safe to retry.

## Immutability once applied

Once a migration has been applied, treat its file as **immutable**. The tool records a checksum of the source at apply time and re-verifies it on every later run; editing an applied migration makes its source diverge from the data it actually produced. A mismatch warns by default (`onChecksumMismatch: 'warn'`) and can be escalated to a hard failure (`'fail'`). To change behaviour, write a *new* migration rather than editing a shipped one.

## Checklist

- [ ] Filename is `<timestamp>__<description>.ts` with a UTC `YYYYMMDDThhmm` prefix (generated via `new`).
- [ ] Exports a **named** `const up = async ({ db }) => { ... }`.
- [ ] Finds items via indexed `pagedQuery`; changes them via per-item `update` — no `Scan`.
- [ ] `up` is **idempotent**: re-running over already-migrated items is a no-op.
- [ ] No `down` / rollback.
- [ ] Once applied, the file is never edited.
