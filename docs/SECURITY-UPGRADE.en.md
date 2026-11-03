# Authentication hardening upgrade

This upgrade uses Workers and D1. It does not disable `workers_dev`, introduce a paid service, or put an Access gateway in front of public routes. Read this before upgrading an existing installation.

## Upgrade an existing self-hosted installation

1. Back up D1 using your existing backup procedure and securely retain the **original** owner/integration API keys in your client secret stores. The dashboard and DB will no longer let you recover a key. If a key is already lost, regenerate it after upgrading and explicitly update each affected client; never use `hashed:<id>` or the SHA-256 digest as a Bearer credential.
2. Apply your ordinary pending migrations first, then apply `packages/db/migrations/074_security_hardening.sql` **once, before deploying the new Worker**. For this branch, explicit application is possible:

   ```sh
   pnpm exec wrangler d1 execute YOUR_DATABASE --remote --file=packages/db/migrations/074_security_hardening.sql
   ```

   This adds hash/scopes columns, the indexed legacy-backfill queue, sessions, rate limits and audit tables. SQL alone does **not** hash credentials: the conversion uses Web Crypto in the next steps. Do not apply `schema.sql` or `bootstrap.sql` over an existing database as an upgrade substitute. On a partial SQL failure, inspect applied columns/tables and repair the migration before proceeding; the ALTER statements are not repeatable.
3. Deploy the matching Worker and admin frontend using your normal deployment process. Old raw-key cookies now fail authentication; log in again. Do not keep old Worker versions writing keys during backfill. Preserve `API_KEY` / `LEGACY_API_KEY` as server-side Cloudflare Secrets; the change concerns persisted staff credentials, not LINE channel tokens, OAuth secrets, or webhook signing keys.
4. Finish backfill for **all** staff, including inactive staff. A successful legacy-key authentication also upgrades that one row, but is not enough to migrate inactive/unused keys. Run the supplied bounded script from a trusted shell:

   ```sh
   export HARNESS_WORKER_URL=https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev
   # Set HARNESS_OWNER_API_KEY securely in the process environment; do not put it in shell history.
   node scripts/migrate-staff-keys.mjs
   unset HARNESS_OWNER_API_KEY
   ```

   The owner-only `POST /api/auth/migrate-keys` converts at most 25 keys per call. The script stops at zero converted rows, at 1,000 batches, or on any error; it does not retry failed requests automatically. A rerun is safe: compare-and-swap prevents overwriting concurrent rotation/deactivation. For final verification, check the bounded pending-index query below; a zero CAS result can also mean concurrent writers, so stop legacy writers and verify emptiness. Original raw keys still work for SDK/MCP/official-account callers after conversion. Hashes/placeholders do not.

   ```sql
   SELECT id FROM staff_members INDEXED BY idx_staff_members_plaintext
   WHERE api_key NOT GLOB 'hashed:*' ORDER BY id LIMIT 1;
   ```

   An empty result confirms no remaining plaintext staff rows. Old backups/time-travel history may retain earlier plaintext; apply your backup retention policy and rotate compromised keys. Do not describe backups as sanitized by this migration.
5. Remove `NEXT_PUBLIC_ADMIN_API_KEY` from builds and configuration; revoke/rotate any secret previously published through it, including reuse in `API_KEY` or other systems. Rebuild the admin. `/admin/update/*` now requires an **owner cookie session**, plus `X-CSRF-Token` for mutations; old `x-admin-api-key` and Bearer-only update requests are rejected. SSE uses `withCredentials`. CLI direct Cloudflare update remains available.
6. Check login/logout, staff key rotation, scoped read/send calls, incoming images, LINE and Stripe webhooks, LIFF/forms, `/t`, `/r`, and workers.dev. Retain the existing `ADMIN_ORIGIN` and cross-site cookie configuration described in [ADMIN-AUTH.md](ADMIN-AUTH.md). Do not roll back to a plaintext-only Worker after backfill: it cannot authenticate hashed staff keys. Use a forward fix, or restore the whole matching pre-upgrade DB/code pair during controlled maintenance (this loses later data).

## Credentials, scopes and sessions

- Staff keys are high-entropy random values. Creation and rotation return plaintext **once**; only SHA-256, last four characters, and a non-secret unique placeholder are persisted. Indexed hash lookup avoids table scans. Use generated random keys, not passwords.
- `apiScopes: null` keeps existing role-based access. `[]` denies all authenticated operations. `messages:read` allows message/friend/chat/inbox/incoming-image reads; `messages:send` allows individual friend/chat sends and image upload. Invalid stored scope JSON denies access. Scopes restrict roles; an owner role does not bypass a scope restriction. New endpoints are denied unless explicitly allowlisted. Scoped keys cannot log into the admin, mint sessions, or use the broad LINE proxy.
- Cookie contains a random 256-bit `lhs_…` ID; D1 holds its digest, staff ID, credential fingerprint, issue/expiry/revocation timestamps and role. Cookies remain HttpOnly, Secure and SameSite=Lax by default (explicit cross-site opt-in uses None). Expiry is seven days, not sliding. Logout revokes the session. `POST /api/auth/sessions/revoke` revokes all the caller's sessions; staff deactivation/deletion, current role/scope changes, and key rotation invalidate old sessions. Owner env sessions require the issuing primary or legacy key to remain configured.
- Existing and new incoming-image URLs require authentication and use `private, no-store`. Public outbound/rich-menu images remain public. Purge historical incoming images from any external CDN/browser caches where feasible: a server cannot recall copies already downloaded or cached under old public headers.
- Stripe rejects unconfigured signatures (503), missing/invalid signatures (401) and stale timestamps. LINE HMAC uses Web Crypto verification. Shared comparisons cover keys, CSRF, SSO, OAuth state/nonces and other signed tokens.

## Optional Cloudflare Access

Default: off. Set `ACCESS_REQUIRED=true`, `ACCESS_TEAM_DOMAIN=YOUR_TEAM.cloudflareaccess.com` and `ACCESS_AUD=YOUR_APPLICATION_AUDIENCE` to require a verified `Cf-Access-Jwt-Assertion` **in addition to** Harness authentication on protected API/update/proxy routes and login/SSO. Issuer, audience, RS256 signature, exp/iat/nbf and email are validated using the configured team's JWKS; untrusted domains, missing configuration and verification failures reject access. This is not an email-to-owner SSO mapping.

Configure any Access edge policy only for private paths. A whole-host policy would block LINE webhooks, public images, `/auth`, LIFF/forms and redirects before the Worker can exempt them. workers.dev stays enabled; direct requests to protected Worker paths still require the JWT when enabled. API clients must supply valid assertions too. The migration script does not acquire Access JWTs: perform migration before opting in, or call the migration endpoint with an explicitly supplied valid assertion and owner credential. [Cloudflare's JWT validation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Rate limits, audit and retention

D1 fixed-window limits are shared across isolates: login/SSO **10 per 5 minutes per IP**; failed key/session authentication **1,000 per minute per IP and per credential** (including LINE proxy). The IP limit is checked first so changing fake keys cannot bypass it. Only Cloudflare's `CF-Connecting-IP` is trusted; missing IP shares an `unknown` bucket. Login/SSO issuance limits apply to all attempts; key/session limits apply only to failures. Fixed windows can allow two adjacent-window bursts. Saturated counters stop incrementing; 429 includes Retry-After. Storage failure fails closed, without silently reverting to isolate-local limits. The existing in-memory general burst guard is supplementary, not the shared security boundary.

`auth_audit_log` stores actor ID, a fixed action/outcome, Unix timestamp and IP. It excludes keys, cookies, signatures, URLs, request/response bodies and user agents. Login/logout/SSO, rejected key/Access authentication, staff changes, key migration, session revocation and update attempts are logged. Mutation records say `attempted`, not that the action completed; a later role check or business operation can fail. Rate-rejected floods do not create per-attempt audit rows. This is a minimal audit trail, not a complete compliance log. Restrict DB access; IPs are personal data.

Owner `POST /api/auth/maintenance` deletes at most 100 expired rate buckets, 100 expired sessions, and 100 audit rows older than 90 days per call, using expiry indexes. **No new Cron or notification is installed.** Integrate this bounded endpoint into your existing authorized maintenance routine and monitor backlog/storage; expiry rejects credentials even before cleanup. Audit retention is therefore a cleanup threshold, not a guaranteed deletion deadline.

Key/session limits count failures only (including invalid sessions); valid credentials bypass saturated IP buckets. Authentication runs before the failure limiter so shared-IP attackers cannot lock out valid users. Login/SSO issuance limits are unchanged.

## Processing/cost design and verification limits

| Entry | SQL calls × row scope |
| --- | --- |
| Login/SSO attempt | 1 rate UPSERT × one hashed-IP row, then credential/SSO checks; login success adds 1 session INSERT + 1 audit INSERT |
| Bearer/key authentication | Successful key/session authentication: no rate-limit SQL. Failed authentication: up to 2 rate UPSERTs × one hashed bucket each; normally 1 indexed staff-hash lookup (miss adds 1 legacy-key lookup); legacy hit adds 1 conditional UPDATE |
| Cookie request | 1 session PK lookup + up to 1 staff PK lookup; last-seen UPDATE at most once per five-minute interval per session |
| Audit | 1 INSERT per recorded action, plus primary/time index maintenance |
| Backfill | 1 pending-index scan limited to 25 + at most 25 PK conditional UPDATEs; no full-table COUNT |
| Revoke all sessions | 1 staff/expiry-index UPDATE × all active sessions for the caller; linear in that caller’s active sessions, not all users |
| Explicit maintenance | 3 indexed DELETE statements, at most 100 rows each; no retries or polling |

For B failed key/session requests and L login attempts/day, limiter statements are at most `2B + L`, before supplementary local rejection; network retries count as new requests. Identity cardinality affects retained storage. Unrelated history growing 100×/1,000× must not widen point lookups or bounded maintenance; more requests scale calls linearly. New synthetic tests exercise actual helpers at 100/10,000/100,000 rows, check bounded work/index use, concurrency, expiry and failed-storage behavior. `pnpm check:cost` includes these and the existing SQLite VM cost regression/negative-index control. SQLite VM instructions are **not D1 billed rows**.

Not verified here: deployed D1 billing rows, Workers CPU/latency, production multi-isolate behavior, live Access/JWKS rotation, real browser third-party-cookie delivery, CDN cache purge, and real LINE/Stripe delivery. No production load test, migration, publish or deployment was performed. Free-tier fit and monthly cost are unmeasured, not assumed zero. No spending cap, automatic customer shutdown or notification service is introduced.

Backfill stays at 25 rows to leave room for authentication within the [Workers Free D1 limit of 50 queries per invocation](https://developers.cloudflare.com/d1/platform/limits/). Live CPU and billing remain unmeasured. Session revocation scales with the caller’s own session count; rate limits bound issuance, not total retained database size.
