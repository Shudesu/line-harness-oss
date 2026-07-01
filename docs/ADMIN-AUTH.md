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

## Troubleshooting

### Admin login fails with a CORS error (`No 'Access-Control-Allow-Origin'`)

**Symptom.** The login page shows a connection/failure message and the browser
console logs:

```text
Access to fetch at 'https://<worker>.workers.dev/api/auth/login'
from origin 'https://<admin>.pages.dev' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Cause.** `ADMIN_ORIGIN` is not set on the Worker, so the admin Pages origin is
not on the credentialed-CORS allowlist and the Worker returns no
`Access-Control-Allow-Origin` header (see `resolveCorsOrigin` in
`apps/worker/src/middleware/admin-auth-config.ts`). `create-line-harness` sets
`ADMIN_ORIGIN` / `ADMIN_ALLOW_CROSS_SITE` **after** deploying the admin, so a
setup that aborted earlier (for example the Worker-deploy failure fixed in
`create-line-harness@0.1.27`, issue #177) never reaches that step and leaves the
Worker without them.

**Confirm.** The Worker logs a hint on every rejected request — tail them and
retry the login:

```bash
npx wrangler tail <worker-name>
# → [admin-auth] CORS rejected origin "https://<admin>.pages.dev" on /api/auth/login but ADMIN_ORIGIN is empty. ...
```

You can also list the Worker's secrets and check `ADMIN_ORIGIN` is absent:

```bash
npx wrangler secret list --name <worker-name>
```

**Fix (existing install).** Add the two secrets — they persist across redeploys
(use your real admin URL, including any `-<suffix>` in the Pages project name):

```bash
printf '%s' 'https://<admin>.pages.dev' | npx wrangler secret put ADMIN_ORIGIN --name <worker-name>
printf '%s' 'true' | npx wrangler secret put ADMIN_ALLOW_CROSS_SITE --name <worker-name>
```

Reload the admin page and log in again. Alternatively, re-run
`npx create-line-harness@latest` (≥ `0.1.27`), which sets these automatically.
