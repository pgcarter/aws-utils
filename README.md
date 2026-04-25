# aws-utils

A pnpm workspace of small, type-safe wrappers around the AWS SDK v3.

## Packages

| Package | Description |
| --- | --- |
| [`@bewdym8/dynamodb`](./packages/dynamodb/README.md) | Single-table DynamoDB client with typed entities, GSI support, and paginated queries. |
| `@bewdym8/s3` | S3 helpers (presigned URLs, common operations). |
| `@bewdym8/kinesis` | Kinesis helpers. |
| `@bewdym8/core` | Shared utilities used across the other packages. |

## Requirements

- Node `>=24` (see `.nvmrc`)
- pnpm `9.12.3` (declared in `packageManager`)

## Workspace scripts

```sh
pnpm install        # install all workspaces
pnpm build          # build every package
pnpm test           # run tests in every package
pnpm typecheck      # typecheck source and tests
pnpm clean          # remove dist + tsbuildinfo
```

To run a script against a single package:

```sh
pnpm --filter @bewdym8/dynamodb test
```
