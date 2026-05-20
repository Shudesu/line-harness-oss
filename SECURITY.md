# Security Policy

## Supported versions

Security fixes are prioritized for the latest public release and the current `main` branch.

## Reporting a vulnerability

Please do not report security vulnerabilities in public GitHub issues.

Use GitHub private vulnerability reporting when available, or contact the maintainer privately through the GitHub profile for `Shudesu`.

When reporting, include:

- A short description of the impact.
- Reproduction steps or a minimal proof of concept.
- Affected files, endpoints, packages, or deployment settings.
- Any logs with secrets and personal data removed.

## Secrets and production data

Never paste these into issues, PRs, commits, screenshots, or logs:

- LINE channel secrets or access tokens.
- Cloudflare API tokens, account IDs, D1 database IDs, or Pages credentials.
- Webhook signing secrets.
- Customer data, friend IDs, message contents, or production exports.

If a secret was exposed, rotate it first, then notify maintainers.
