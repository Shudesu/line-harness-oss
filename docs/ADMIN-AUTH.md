# Admin Authentication (cookie session + CSRF)

The admin dashboard authenticates against the Worker API with
**email/password → signed HttpOnly session cookie**. Humans should not paste an
API key into the dashboard. API keys remain for SDK/MCP/server-to-server
Bearer-token access only.

## Login method compatibility contract

Do **not** change the admin dashboard login method back to API-key entry.
The human-facing admin UI must continue to use **email/password + HttpOnly
cookie session** authentication. API keys are intentionally reserved for
machine-to-machine SDK/MCP/Bearer-token integrations, not browser login.

## How it works

1. **Login** — `POST /api/auth/login { email, password }`. The Worker
   validates the bootstrap `ADMIN_EMAIL` / `ADMIN_PASSWORD` pair or an
   `admin_users.password_hash` record, then sets two cookies:
   - `lh_admin_session` — a signed opaque admin session token. **HttpOnly**,
     `Secure`, `Path=/`, `Max-Age=604800`. JavaScript can never read it.
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

The legacy `POST /api/auth/login { apiKey }` path is kept only for backwards
compatibility with old callers. The admin UI must use `{ email, password }`.

## Topology & configuration

Cookies only reach the API if `SameSite` matches the topology. The Worker reads
these environment variables (see
`apps/worker/src/middleware/admin-auth-config.ts`):

| Variable | Purpose |
|----------|---------|
| `ADMIN_EMAIL` | Bootstrap owner email for dashboard login. |
| `ADMIN_PASSWORD` | Bootstrap owner password for dashboard login. Prefer a Worker secret. |
| `ADMIN_SESSION_SECRET` | Required long random secret used to sign browser admin sessions. Keep it separate from `API_KEY`. |
| `ADMIN_ORIGIN` | Comma-separated allowlist of admin origins for credentialed CORS. No trailing slash. |
| `ADMIN_ALLOW_CROSS_SITE` | `true` → issue `SameSite=None; Secure` cookies (required when admin and API are cross-site). |
| `ADMIN_COOKIE_SAMESITE` | Optional explicit override: `Strict` \| `Lax` \| `None`. |

### Two supported deployments

**(a) Cross-site Pages ↔ Workers (default).** Set
`ADMIN_ORIGIN=https://<admin>.pages.dev` and `ADMIN_ALLOW_CROSS_SITE=true`.
`create-line-harness` does this automatically after deploying the admin.
Cookies are `SameSite=None; Secure`; CSRF protects mutations; CORS is locked to
the allowlist.

> ⚠️ Browsers are phasing out third-party cookies (Safari ITP blocks them
> outright). For long-term robustness prefer option (b).

**(b) Same-site custom domains (recommended).** Serve the admin and API under
one registrable domain — e.g. `admin.example.com` (Pages custom domain) and
`api.example.com` (Worker route). Set `ADMIN_ORIGIN=https://admin.example.com`
and leave `ADMIN_ALLOW_CROSS_SITE` unset; cookies use `SameSite=Lax` and no
third-party-cookie restrictions apply.

### Setting these in the fork + GitHub Actions flow

Set them as **repository Variables** (Settings → Secrets and variables →
Actions → Variables), the same place you set `WORKER_NAME` / `VITE_LIFF_ID`:

| Variable | Value |
|----------|-------|
| `ADMIN_ORIGIN` | `https://<admin>.pages.dev` (or your admin custom domain) |
| `ADMIN_ALLOW_CROSS_SITE` | `true` for the cross-site Pages↔Workers default; omit for same-site |
| `WORKER_URL` | `https://<worker>.workers.dev` (your Worker's public URL) |

`deploy-cloudflare-worker.yml` bakes these into the deployed Worker config on
every deploy, so they survive redeploys.

> 🚫 **Do not** add these by hand as plain Worker variables in the Cloudflare
> dashboard. A `wrangler deploy` from config that doesn't include them will
> drop them, and the admin login breaks with a CORS error
> (`No 'Access-Control-Allow-Origin' header`). Use repo Variables (above) so
> they are part of the deployed config — or, for an existing install, set them
> as Worker **secrets** (`wrangler secret bulk`), which persist across deploys.

### Topology guard

If the admin is cross-site to the API but `SameSite` is not `None` (e.g. the old
`SameSite=Strict`, or a custom domain misconfiguration), `POST /api/auth/login`
**refuses with a 500 and an actionable error** rather than silently issuing a
cookie the browser will drop. This converts the "login breaks after deploy"
failure mode into a clear configuration error.
