# Admin Authentication (cookie session + CSRF)

The admin dashboard authenticates against the Worker API with an **HttpOnly
session cookie** instead of an API key stored in `localStorage`. This removes
the XSS-exposed credential (OSS security issue #102) while keeping SDK/MCP
Bearer-token access unchanged.

## How it works

1. **Login** — `POST /api/auth/login { apiKey }`. The Worker validates the key
   (staff table, `API_KEY`, or `LEGACY_API_KEY`) and sets two cookies:
   - `lh_admin_session` — an opaque session ID; the API key is never stored here. **HttpOnly**, `Secure`, `Path=/`,
     `Max-Age=604800`. JavaScript can never read it.
   - `lh_csrf` — a random CSRF token. Readable, `Secure`. Also returned in the
     response body.
2. **Authenticated requests** — the browser sends `lh_admin_session`
   automatically (`credentials: 'include'`). For state-changing requests
   (`POST/PUT/PATCH/DELETE`) the SPA also sends the CSRF token in the
   `X-CSRF-Token` header; the Worker rejects the request (`403`) unless that
   header matches the `lh_csrf` cookie (double-submit).
3. **Session check** — `GET /api/auth/session` returns the staff identity and
   the current CSRF token (minting one if missing), letting the SPA recover the
   token after a reload without re-login.
4. **Logout** — `POST /api/auth/logout` revokes the opaque session in D1 and expires both cookies. `POST /api/auth/logout-all` revokes all sessions for the current identity (cookie callers must supply CSRF). Bearer API keys are not revoked.

### Why the CSRF token is also returned in the body

In the default cross-site topology the admin (`*.pages.dev`) and the API
(`*.workers.dev`) are on different registrable domains. The `lh_csrf` cookie
belongs to the API's domain, so the SPA's JavaScript on the admin domain
**cannot read it**. The token is therefore delivered in the login/session
response body and cached client-side; the Worker still validates it against its
own cookie, which the browser does send back (`SameSite=None`).

### Bearer tokens are unaffected

SDK and MCP callers continue to send `Authorization: Bearer <key>`. They are not
cookie-driven, so CSRF enforcement does not apply to them, and CORS does not
affect non-browser (no `Origin`) callers.

## Topology & configuration

Cookies only reach the API if `SameSite` matches the topology. The Worker reads
three environment variables (see
`apps/worker/src/middleware/admin-auth-config.ts`):

| Variable | Purpose |
|----------|---------|
| `ADMIN_ORIGIN` | Comma-separated allowlist of admin origins for credentialed CORS. No trailing slash. |
| `ADMIN_ALLOW_CROSS_SITE` | `true` → issue `SameSite=None; Secure` cookies (required when admin and API are cross-site). |
| `ADMIN_COOKIE_SAMESITE` | Optional explicit override: `Strict` \| `Lax` \| `None`. |

### Two supported deployments

**(a) Cross-site Pages ↔ Workers (default).** Set
`ADMIN_ORIGIN=https://<admin>.pages.dev` and `ADMIN_ALLOW_CROSS_SITE=true`.
`create-line-harness` does this automatically after deploying the admin.
Cookies are `SameSite=None; Secure`; CSRF protects mutations; CORS is locked to
the allowlist.

Cloudflare Pages also prints per-deployment preview URLs such as
`https://<hash>.<admin>.pages.dev`. Those preview origins are treated as the
same admin Pages project, so clicking Wrangler's fresh deployment URL does not
cause a login-time CORS failure.

> ⚠️ Browsers are phasing out third-party cookies (Safari ITP blocks them
> outright). For long-term robustness prefer option (b).

**(b) Same-site custom domains (recommended).** Serve the admin and API under
one registrable domain — e.g. `admin.example.com` (Pages custom domain) and
`api.example.com` (Worker route). Set `ADMIN_ORIGIN=https://admin.example.com`
and leave `ADMIN_ALLOW_CROSS_SITE` unset; cookies use `SameSite=Lax` and no
third-party-cookie restrictions apply.

### Topology guard

If the admin is cross-site to the API but `SameSite` is not `None` (e.g. the old
`SameSite=Strict`, or a custom domain misconfiguration), `POST /api/auth/login`
**refuses with a 500 and an actionable error** rather than silently issuing a
cookie the browser will drop. This converts the "login breaks after deploy"
failure mode into a clear configuration error.

---

## External SSO (`ADMIN_SSO_SECRET`) — optional

Typing an API key is fine for one operator and miserable for a portal that
already knows who the user is. `GET /admin/sso?token=…` lets **any issuer you
control** — an internal ops portal, a small IdP bridge, a script behind your
own Google/Okta/SAML login — drop a browser straight into an admin session.

**Off unless you turn it on.** With `ADMIN_SSO_SECRET` unset the route answers
exactly like any unregistered path. Nothing changes for existing deployments;
there is no new attack surface to reason about until you opt in.

```sh
# ≥32 characters. Treat it as sensitive as API_KEY.
openssl rand -base64 48 | tr -d '\n' | wrangler secret put ADMIN_SSO_SECRET
```

> **Trust model:** anyone holding `ADMIN_SSO_SECRET` can mint an owner session
> without knowing `API_KEY`. Your issuer is the authentication step — the
> Worker only verifies that *your issuer* vouched for this browser, just now,
> once. Rotate the secret the same way you rotate `API_KEY`.

### Token format

```
token       = base64url(payloadJson) "." base64url(signature)
signature   = HMAC-SHA256(key     = ADMIN_SSO_SECRET, UTF-8 bytes
                          message = base64url(payloadJson), ASCII bytes)
```

The signature covers the **encoded** payload segment exactly as it appears in
the token (the JWS convention), not the raw JSON — so JSON key order and
whitespace never have to match. Both base64url encodings are **unpadded** and
use the URL-safe alphabet (`-`, `_`).

| Claim | Required | Meaning |
|-------|----------|---------|
| `aud` | yes | Must be the literal `"admin-sso"`. |
| `iat` | yes | Issued-at, unix seconds. Rejected if more than 60 s ahead of the Worker's clock. |
| `exp` | yes | Expiry, unix seconds. Must be in the future, and `exp - iat` must be **≤ 300 s**. |
| `jti` | yes | Unique per token; `[A-Za-z0-9._:-]{8,128}` (a UUID is ideal). Single-use. |
| `sub` | no | Display/audit only — appears in the Worker log. **Never** an authorization input. |

### Issuer pseudocode

```js
const payload = {
  aud: 'admin-sso',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 60,   // keep it short; 300 s is the ceiling
  jti: crypto.randomUUID(),
  sub: 'ops@example.com',                    // optional, for the audit log
};

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(ADMIN_SSO_SECRET),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
);
const sig = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded)));

// Redirect the browser here. Mint it at click time, never in advance.
const url = `${WORKER_URL}/admin/sso?token=${encodeURIComponent(`${encoded}.${sig}`)}`;
```

`apps/worker/src/lib/admin-sso-token.ts` exports `signAdminSsoToken()` — the
same code path the Worker verifies against, reusable if your issuer is
TypeScript.

### What the Worker does

1. **`ADMIN_SSO_SECRET` unset** → 404 (the feature does not exist).
2. **Secret shorter than 32 chars, `API_KEY` missing, or a cookie-dropping
   topology** → 500 with an actionable message, same philosophy as the login
   topology guard above.
3. **Bad signature, wrong `aud`, expired, `exp - iat > 300 s`, `iat` too far in
   the future, or a replayed `jti`** → 403 with one **identical** page for every
   cause. The specific reason goes to the log (`[admin-sso] rejected reason=…`),
   never to the client — a rejection page that names the cause is an oracle.
4. **Valid** → sets the same `lh_admin_session` + `lh_csrf` cookies
   `POST /api/auth/login` issues for the env `API_KEY` (so the session is an
   `owner`), logs `[admin-sso] accepted jti=… sub=…`, and 302s to the first
   `ADMIN_ORIGIN` entry (falling back to `ADMIN_PUBLIC_URL`, then `/`). The
   redirect target comes only from configuration, never from the request, so
   this can never be turned into an open redirect.

### Replay protection

Tokens ride in a URL, so they land in browser history, `Referer` headers and
proxy logs. Signature + `exp` alone would let anyone who scrapes one out of a
log replay it until it expires. The Worker therefore burns `jti` in the
`sso_jti` table (migration `070_admin_sso_jti`) — an `INSERT OR IGNORE` that
grants the session only when it actually inserted a row. Expired rows are swept
lazily in the same batch, so no cron is needed and the table stays tiny.

If that table is unreachable the request **fails closed with a 500**: a session
we cannot make single-use would silently turn every SSO link into a permanent
credential.

### Operational notes

- Mint tokens at click time. A token pre-generated into an email or a dashboard
  is a credential sitting in someone's inbox.
- The SSO response sends `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer` so the token does not leak onward.
- The resulting session is indistinguishable from an API-key login, including
  CSRF handling and the 7-day cookie lifetime. `POST /api/auth/logout` ends it.


## Troubleshooting: admin login fails with CORS

An incomplete setup can leave `ADMIN_ORIGIN` unset, so a browser reports a
missing `Access-Control-Allow-Origin` header even though the Worker is running.
A value without an absolute URL scheme, such as `example-admin.pages.dev`, can
produce the same symptom because no configured origin can be parsed.

For a rejected HTTP(S) origin on an `/api/auth/*` route with an empty parsed
allowlist, the Worker emits one structured warning:

```json
{"component":"admin-auth","code":"admin_origin_empty","message":"ADMIN_ORIGIN is empty. Set it to the admin URL; enable ADMIN_ALLOW_CROSS_SITE for the Pages/Workers topology. See docs/ADMIN-AUTH.md."}
```

`admin_origin_invalid` means the setting has a value but no entry parses as an
origin; check that the admin URL includes `https://`. The log deliberately omits
request origins, paths, and configuration values. Its fixed messages remain
bounded and cannot include request-controlled line breaks or a secret pasted
into the wrong setting.

The diagnostic is limited to **one warning per loaded Worker module/isolate**,
even if successive requests use different environment objects. It is advisory:
an anonymous first auth probe may consume the warning before the operator opens
logs, and a later request will not emit it again. Missing log output does not
prove configuration is correct. The warning never changes the allowlist,
cookie configuration, or the decision to reject a request.

To investigate an existing installation, inspect Worker logs and whether the
setting exists:

```sh
npx wrangler tail <worker-name>
npx wrangler secret list --name <worker-name>
```

A listed secret name does not verify its value. Confirm the full admin origin
and follow the topology instructions above. For the usual Pages/Workers setup,
set `ADMIN_ORIGIN` to the actual admin URL and `ADMIN_ALLOW_CROSS_SITE` to `true`.
Use secret settings so they survive redeploys; no diagnostic requires an
immediate production redeploy just to produce a fresh log entry.


## Opaque sessions and credential storage

Apply `074_security_hardening.sql` and `079_admin_security_keys_passkeys.sql` before deploying
code which issues opaque sessions. Normal setup and update workflows use the
migrations/bootstrap metadata; do not replay unrelated migrations manually.

New login and SSO cookies contain `lhs_` plus 32 random bytes (base64url), never
the API key. D1 stores only the SHA-256 of that session token. Session state
includes an absolute expiry, current credential fingerprint and issuing role.
Each request checks revocation, expiry and the current staff record. Disabled,
deleted or role-changed staff, or rotated credentials, cannot keep using the old
session even if the best-effort bulk cleanup hook failed. Session tokens cannot
be used as Bearer API credentials.

`ADMIN_SESSION_TTL_SECONDS` defaults to 604800 (7 days), capped at 30 days.
`ADMIN_LEGACY_SESSION_COOKIE=accept` is the initial default: a verified old
raw-key cookie is upgraded on its next authenticated request without changing
the API key or requiring re-login. Missing/invalid CSRF never triggers a session
write. Migration failure preserves already-verified legacy cookie access while
logging a warning; new opaque sessions fail closed. New logins require the
session table and return an actionable 503 if storage is unavailable.
`ADMIN_LEGACY_SESSION_COOKIE=reject` is an explicit operator choice after
migration. It does not disable Bearer credentials. No date-based automatic
change or global logout is introduced by this release.

A successful logout invalidates the opaque cookie server-side. If revocation
storage fails, browser cookies are still cleared and the API returns 503;
server revocation is not falsely reported as successful. Old raw API keys
remain credentials during the compatibility period; logout never revokes a key
used by other SDK/MCP integrations.

Staff keys are stored as a SHA-256 digest, display suffix and storage placeholder
`hashed:<staff-id>`. The plaintext is returned once at create/rotation. Existing
keys retain their values and are migrated lazily or in batches of 100 on the
existing six-hour maintenance tick. Unknown legacy issuance dates stay NULL.
Placeholders cannot authenticate. Do not roll back to code that only understands
plaintext keys after any key has been converted. Deploy compatible code across
the target before running a separate backfill. Keep an operator credential in
the normal protected credential store; do not depend on retrieving plaintext
keys from D1 for operational access.

Session cleanup deletes at most 100 expired rows per six-hour maintenance tick.
Expired sessions are rejected immediately regardless of cleanup backlog. No
session activity metadata is cached for authorization, and last-seen writes are
conditional at five-minute intervals. Multiple tenants with separate D1s keep
separate session stores; cookies omit Domain and stay host-scoped. Cross-database
replay is covered by synthetic HTTP tests.

## Optional Cloudflare Access identity login

Configure an Access application for the API host's `/auth/access/*`, its team domain
in `ACCESS_TEAM_DOMAIN` (only `*.cloudflareaccess.com`) and application audience in
`ACCESS_AUD`. Register staff email addresses before enabling; do not protect all
Bearer API paths and break integrations. Pages may separately be protected by Access.
On workers.dev, use the supported Access protection for that Worker hostname; custom
domain installs must cover the actual external API hostname. Configure exactly one
ADMIN_ORIGIN and the existing cookie topology settings for the admin SPA.

`GET /auth/access/login` validates the assertion JWT with jose/RS256, issuer,
audience, timestamps and email, not the unsigned email header. JWKS is issuer-bound,
HTTPS, one-hour per-isolate cache, five-second fetch timeout and 30-second cooldown
for unknown-kid refresh (avoids attacker-driven fetch loops). See
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ .
Missing/partial/invalid configuration leaves the route unavailable; existing API login
continues. No Access application, policy or paid plan is created by this code change.

Normalized staff email uses a non-unique expression index and LIMIT 2. Existing
duplicates do not fail a migration; duplicate, inactive or restricted-key identities
cannot log in. They never fall through to `ACCESS_OWNER_EMAILS`. That optional explicit
allowlist only bootstraps an owner where no staff record matches. No auto-created
staff or claim-derived promotion. Access sessions are capped at JWT expiry, and
email/config changes, credential rotation, disabled staff and removed owner allowlist
entries invalidate sessions on next use. API-key sessions retain their old behavior.

403: check actual JWT issuer/audience, expired token/clock, staff email uniqueness and
active state. 503: check migration 087 and ADMIN_ORIGIN/cookie configuration. Redirects
are restricted to the configured admin origin, even for malformed `next` values.
The methods endpoint exposes only feature availability and relative login URL.

Cost: login adds one indexed normalized-email lookup (max 2 rows), one session insert.
Access session revalidation adds one such lookup to existing session/staff PK queries;
root fallback also checks that no staff identity now shadows it. No new cron, full
staff scans or automatic email repairs. Actual production billed rows/CPU unmeasured.

## Explicit API-key login retirement controls

`API_KEY_LOGIN_MODE` defaults to `allow`. `break-glass` accepts only the current
env API_KEY (not staff/legacy keys), issues a maximum one-hour session and labels its
auth method. `disabled` refuses API-key login. Unknown nonempty values fail closed.
Bearer integrations remain unchanged. New raw-key cookie upgrades are refused in
both restricted modes, otherwise they could bypass `/api/auth/login`. Existing
opaque sessions remain valid until normal expiry/revocation; no mass logout occurs.

No automatic date/default switch is implemented. Do not enable restrictions before
an alternative owner/admin login has been tested and a recovery path recorded.
The proposal's 90-day notice period has not started and is not represented as elapsed.
This code does not announce retirement, revoke existing credentials or configure an
identity provider. Public methods/UI indicate the operator's actual selected mode.

## Self-update owner authentication

`/admin/update/*` now uses ordinary authenticated human owner identity. Cookie writes
require CSRF; owner API Bearer works for automation. A machine/admin/staff identity
cannot update the Worker. The old `x-admin-api-key`/NEXT_PUBLIC_ADMIN_API_KEY value
alone is deliberately rejected: a value embedded in browser JS is not secret.
UI fetch/poll/SSE use the opaque cookie; the version endpoint exposes only the
boolean self_update_configured. Existing message/read integrations are unaffected.
Any bespoke updater using only the old header must switch to owner Bearer; do not
restore public-header authentication as a compatibility exception. No real update
was triggered by validation. Existing API_KEY remains the server's owner credential.
