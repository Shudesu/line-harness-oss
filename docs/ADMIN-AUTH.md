# Admin Authentication (cookie session + CSRF)

The admin dashboard authenticates against the Worker API with an **HttpOnly
session cookie** instead of an API key stored in `localStorage`. This removes
the XSS-exposed credential (OSS security issue #102) while keeping SDK/MCP
Bearer-token access unchanged.

## How it works

1. **Login** — `POST /api/auth/login { apiKey }`. The Worker validates the key
   (staff table, `API_KEY`, or `LEGACY_API_KEY`) and sets two cookies:
   - `lh_admin_session` — the credential. **HttpOnly**, `Secure`, `Path=/`,
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
4. **Logout** — `POST /api/auth/logout` expires both cookies.

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
