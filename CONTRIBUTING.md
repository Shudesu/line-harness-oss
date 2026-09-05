# Contributing to L Harness

L Harness is a public OSS LINE CRM. The project welcomes issues and pull
requests, but it also protects real operators, LINE accounts, credentials, and
customer data. This document is the maintainer rulebook for keeping the public
queue useful and safe.

日本語での Issue / PR も歓迎です。英語で書く必要はありません。

## Repository Model

L Harness is maintained with two repositories:

- `Shudesu/line-harness-oss`: public OSS intake for issues, discussions, and
  community pull requests.
- `Shudesu/line-harness`: private source-of-truth for production-safe
  development and deployment.

Bug reports and pull requests should start here in the OSS repository.
Maintainers may reproduce, rewrite, or adapt a fix in the private repository
first, then sync the safe public changes back to OSS with the `private-sync`
label.

This means a community PR may be valuable even if it is not merged as-is.

## Maintainer Principles

Maintainers optimize for user safety over speed.

- We prefer small, reviewable changes over large "all-in-one" PRs.
- We prefer reproducible bug reports over guesses.
- We prefer production-safe syncs over direct public deploy changes.
- We may close or supersede stale, conflicting, too-broad, or unsafe PRs.
- Accepted direction does not mean implementation is guaranteed.

## Contribution Priorities

We review contributions in this order:

1. Security fixes and credential/data protection.
2. Data-loss, duplicate-send, wrong-account, and broadcast safety bugs.
3. Setup, migration, deploy, and upgrade blockers.
4. Regressions in core LINE CRM workflows.
5. Robustness, observability, and operator recovery tools.
6. Focused product improvements with a clear user workflow.
7. Documentation and examples.

Large product ideas are welcome, but they should usually start as issues before
code. Industry-specific or client-specific behavior may be redirected to the
plugin template instead of the core product.

## Before Opening an Issue

- Search existing issues and pull requests.
- Use the closest issue template.
- Include the L Harness version, Node.js version, pnpm version, Wrangler
  version, and deployment target when relevant.
- Include the smallest reproduction you can.
- Remove tokens, account IDs, channel secrets, webhook URLs, friend IDs, message
  contents, customer data, screenshots with private data, and production exports.
- For security vulnerabilities, do not open a public issue. See `SECURITY.md`.

## Issue Triage Rules

Maintainers may apply these labels:

- `security`: security-sensitive, must be handled carefully.
- `bug`: something is not working as intended.
- `accepted`: direction is reasonable, PR welcome, not a delivery promise.
- `needs-info`: waiting for reporter details. May be closed after 30 days
  without response.
- `blocked`: cannot move forward because of conflicts, missing information, or
  repository maintenance.
- `community-driven`: useful but too large for maintainer-owned implementation.
- `good first issue`: suitable for a focused external PR.
- `private-sync`: synced from the private source-of-truth repository.
- `superseded`: replaced by a narrower or safer issue/PR.

Maintainers may retitle, relabel, split, or close issues to keep the queue
understandable.

## Pull Request Rules

Small, focused PRs are easiest to review. A good PR includes:

- One clear problem.
- The smallest practical code change.
- A linked issue, or a clear reason no issue exists.
- Tests, screenshots, command output, or a short verification note.
- A clear statement of what was not tested.
- No production secrets, private configuration, generated build output, or
  unrelated formatting churn.
- Migration files with a placeholder number (for example `NNN_add_feature.sql`).
  The upstream migration chain moves fast, so final numbers are assigned by
  maintainers at merge time. Do not pick the next free number yourself — it
  will almost always conflict by the time the PR lands.

### PRs We Usually Do Not Merge As-Is

Maintainers may close or request a rebuild when a PR:

- Contains unrelated commits or multiple independent features.
- Is based on an old branch and has conflicts.
- Changes deploy workflows, credentials, auth, webhook handling, broadcast
  delivery, migrations, or account scoping without a focused test plan.
- Includes generated artifacts such as `.tsbuildinfo`, build output, or local
  environment files.
- Adds customer-specific behavior to core without a general product reason.
- Discloses secrets, production data, private URLs, or security proof-of-concept
  details.

If your PR is closed for scope, please do not take it personally. A smaller PR
against current `main` is much more likely to land.

## High-Risk Areas

Changes touching these areas require extra care and may be reimplemented through
the private source-of-truth repository before public sync:

- Authentication, sessions, API keys, cookies, CORS, and staff permissions.
- LINE webhook verification, postback handling, reply tokens, and outgoing
  webhooks.
- Broadcast, multicast, step delivery, reminders, deduplication, delivery
  windows, and cancellation.
- D1 schema, migrations, account scoping, friend/tag/scenario ownership, and
  data deletion.
- Cloudflare deploy workflows, Wrangler config, secrets, release automation,
  and update flows.
- MCP tools or SDK methods that can send messages, mutate data, or access
  production-like resources.

## Local Verification

Use the narrowest command that proves your change. Common checks:

```bash
pnpm install --frozen-lockfile
pnpm --filter worker typecheck
pnpm --filter worker test
pnpm --filter web build
pnpm --filter create-line-harness build
```

Not every PR needs every command. Please mention exactly what you ran in the PR
description. If you could not run tests, say why.

For UI changes, screenshots are helpful. For behavior changes, include the
before/after behavior and the command, route, or screen you used to verify it.

## Release and Sync Policy

The public OSS repository is not the production deployment control plane.
Production deployment should happen from the private source-of-truth repository
unless maintainers explicitly say otherwise.

Public PRs may be:

- Merged directly when small and safe.
- Recreated privately and synced back with `private-sync`.
- Superseded by a narrower maintainer PR.
- Closed when stale, conflicting, too broad, or unsafe.

## Security Reports

Do not disclose unpatched vulnerabilities in public issues, pull requests,
screenshots, logs, or discussions. Use GitHub private vulnerability reporting
when available, or contact the maintainer privately through the GitHub profile
for `Shudesu`.

See `SECURITY.md` for the security reporting policy.
