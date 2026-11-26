# Security Policy

L Harness handles LINE accounts, message delivery, customer records, API
keys, Cloudflare credentials, and webhook traffic. Security reports must be
handled privately first.

## Supported Versions

Security fixes are prioritized for:

- the latest public release, and
- the current `main` branch.

Older releases may receive guidance, but maintainers usually fix forward.

## Reporting a Vulnerability

Please do not report security vulnerabilities in public GitHub issues, public
pull requests, screenshots, logs, or discussions.

Use GitHub private vulnerability reporting when available, or contact the
maintainer privately through the GitHub profile for `Shudesu`.

When reporting, include:

- A short description of the impact.
- Affected version, commit SHA, route, package, file, or deployment setting.
- Reproduction steps or a minimal proof of concept against latest `main` or the
  latest release.
- What data, account, credential, or trust boundary can be affected.
- Any suggested remediation.
- Logs with secrets and personal data removed.

Reports with a working reproduction and clear impact are prioritized. Scanner
output without demonstrated L Harness impact may be treated as hardening
rather than a vulnerability.

## What Counts As Security-Sensitive

Report privately if the issue involves:

- API key, session, cookie, staff permission, or CORS bypass.
- LINE channel secret, access token, webhook signature, or reply token handling.
- Unauthenticated access to admin APIs or customer data.
- Cross-account data access between LINE accounts.
- Message sending without the intended operator authorization.
- Duplicate, wrong-target, or unintended broadcast caused by a security control
  failure.
- Secret exposure in logs, releases, workflows, screenshots, or client bundles.
- Cloudflare token, D1 database, Pages, Worker, or deploy workflow compromise.

## Public Issues Are OK For

These can usually be public when sanitized:

- Setup failures.
- Build errors.
- UI bugs.
- Feature requests.
- Non-sensitive delivery behavior where no exploit details or private data are
  disclosed.
- Questions about documented behavior.

If you are unsure, report privately.

## Secrets and Production Data

Never paste these into issues, PRs, commits, screenshots, release notes, or logs:

- LINE channel secrets or access tokens.
- Cloudflare API tokens, account IDs, D1 database IDs, Pages credentials, Worker
  secrets, or Wrangler config with real identifiers.
- Webhook signing secrets.
- Admin API keys, session cookies, staff credentials, or MCP tokens.
- Customer data, friend IDs, LINE user IDs, message contents, form submissions,
  chat transcripts, analytics exports, or production database dumps.

If a secret was exposed, rotate it first, then notify maintainers privately.

## Maintainer Handling

Maintainers may close, hide, edit, or redirect public issues and pull requests
that disclose unpatched vulnerabilities, exploit details, secrets, or production
data. The goal is to protect users while the issue is triaged and fixed.

Security fixes may be developed privately and synced back to OSS after the
public release is safe.
