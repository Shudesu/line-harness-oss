# Contributing to LINE Harness

Thanks for helping improve LINE Harness. This repository is the public OSS intake for issues, discussions, and community pull requests.

## Repository model

LINE Harness is maintained with two repositories:

- `Shudesu/line-harness-oss`: public OSS repository for issues and pull requests.
- `Shudesu/line-harness`: private source-of-truth repository for production-safe development and deployment.

Bug reports and pull requests should start here in the OSS repository. Maintainers may reproduce or adapt a fix in the private repository first, then sync the safe public changes back to OSS.

## Before opening an issue

- Search existing issues and pull requests.
- Include the LINE Harness version, package manager, Node.js version, and deployment target when relevant.
- Remove tokens, account IDs, channel secrets, webhook URLs, and customer data from logs.
- For security issues, do not open a public issue. See `SECURITY.md`.

## Pull request expectations

Small, focused PRs are easiest to review. A good PR usually includes:

- A clear problem statement.
- The smallest practical code change.
- Tests or a short verification note.
- No production secrets, private configuration, or generated build output.

## Local verification

Use the narrowest command that proves your change. Common checks:

```bash
pnpm install --frozen-lockfile
pnpm --filter worker typecheck
pnpm --filter worker test
pnpm --filter web build
```

Not every PR needs every command. Please mention what you ran in the PR description.

## What maintainers may do

Maintainers may label, retitle, split, or supersede PRs so the public queue stays understandable. If an OSS PR needs private integration first, it may be replaced by a targeted `private-sync` PR.
