# aws-utils

A pnpm workspace of small, type-safe wrappers around the AWS SDK v3.

![Claude Code for Real Engineers — 2026-04](https://res.cloudinary.com/total-typescript/image/upload/v1777093044/certificate/f19a3d0b-da7d-4609-9554-bccb84eb9318/claude-code-for-real-engineers-2026-04.png)

Built while following the [Claude Code for Real Engineers](https://res.cloudinary.com/total-typescript/image/upload/v1777093044/certificate/f19a3d0b-da7d-4609-9554-bccb84eb9318/claude-code-for-real-engineers-2026-04.png) course.

## Packages

| Package | Description |
| --- | --- |
| [`@bm8/aws-dynamodb`](./packages/aws-dynamodb/README.md) | Single-table DynamoDB client with typed entities, GSI support, and paginated queries. |
| [`@bm8/aws-dynamodb-streams`](./packages/aws-dynamodb-streams/README.md) | Typed DynamoDB Streams record processor for entities defined with `@bm8/aws-dynamodb`. |
| [`@bm8/aws-dynamodb-migrate`](./packages/aws-dynamodb-migrate/README.md) | Flyway-style, ordered, run-once data migrations for tables built with `@bm8/aws-dynamodb`. |
| `@bm8/aws-core` | Shared utilities used across the other packages. |

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
pnpm --filter @bm8/aws-dynamodb test
```


alias dsc="docker sandbox run claude ."

in claude

- !gh auth login
- 