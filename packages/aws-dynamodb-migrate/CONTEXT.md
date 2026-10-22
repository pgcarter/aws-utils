# DynamoDB Migrate

Executes ordered, one-time data migrations against the items in a DynamoDB table — the Flyway concept applied to schemaless DynamoDB data rather than relational schema. Ships a programmatic core with a thin CLI on top.

## Language

**Migration**:
A single, ordered, run-once transformation of existing item *data* in a DynamoDB table, authored as a TypeScript module that exports an `up` function. Never a change to table or index *structure* (that stays in CDK/CloudFormation).
_Avoid_: Schema migration, script, patch

**Data migration**:
Synonym for Migration, used when contrasting with relational *schema* migrations. The only kind of migration this package performs.

**Ledger**:
The record, stored in the target table under a `DB_MIGRATE` partition, of which migrations have already been applied. The mechanism that makes a run ordered and run-once.
_Avoid_: History, schema history, journal

**Lock**:
A single item in the `DB_MIGRATE` partition, taken via conditional write before a run and released after, that guarantees only one run executes at a time. A dead run leaves a stale Lock that a human clears with `--force-unlock`.

**Repair**:
A human-initiated correction of a `failed` Ledger row after investigation. Two modes: *retry* (delete the row so the migration re-runs) and *resolve* (mark it applied so it is skipped). The tool never repairs automatically.
_Avoid_: Clear, fix, reset