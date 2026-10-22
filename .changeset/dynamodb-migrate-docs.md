---
'@bm8/aws-dynamodb-migrate': patch
---

Adds user-facing documentation: a package `README` (in the style of the other
`@bm8/aws-*` packages, linked from the root packages table) and an authoring
guide.

The README covers what the tool is and isn't (ordered run-once *data*
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
