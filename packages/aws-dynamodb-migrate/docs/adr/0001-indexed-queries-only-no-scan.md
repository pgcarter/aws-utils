# Migrations reach data only through indexed queries, never Scan

A migration's `up({ db })` receives the typed `@bm8/aws-dynamodb` client and reaches items exclusively through indexed `pagedQuery` calls. There is deliberately no `Scan`, and no raw `DynamoDBDocumentClient`/`tableName` escape hatch in the contract.

`Scan` over a large production table is slow, costly, and a capacity hazard; a `pagedQuery` against a GSI partition (the single-table "list all of this type" idiom, e.g. `GSI1PK: 'USERS'`) is targeted and cheap. Leaving a raw-SDK escape hatch open would be the hole through which a `ScanCommand` returns, so the contract is kept pure.

## Consequences

- A migration can only touch items that are already enumerable via an index. An entity with no GSI partition listing its items is unreachable by a migration — by design.
- Bulk changes are expressed as per-item `db.entity.update(...)` loops over `pagedQuery` results, which keeps audit fields and `type` safety and avoids re-implementing `BatchWrite`. Acceptable because index-scoped result sets are bounded.
- If a genuine need for full-table iteration appears later, adding it is additive — but it would reopen the safety/cost trade-off this decision closes.