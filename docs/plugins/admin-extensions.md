# Admin extension screens

Operators can add an external plugin screen to the admin sidebar without adding
plugin-specific code to the admin bundle. This implements the menu/host-page
scope of #409. Existing event forms are not extended by this feature.

Configure the optional, non-secret Worker variable:

```toml
[vars]
ADMIN_EXTENSIONS = '[{"id":"reports","label":"Reports","url":"https://extensions.example/reports/","minRole":"admin"}]'
```

The list is limited to 32 entries and 16 KiB. IDs are unique lowercase letters,
digits and hyphens (2–32 characters, starting with a letter); labels are plain
text up to 20 Unicode code points. URLs must be absolute HTTPS URLs without
userinfo or fragments. Do not put credentials or private data in URLs. Invalid
entries are skipped; invalid top-level configuration returns an empty list.
Diagnostics contain only an entry index and a reason, not labels or URLs.

GET /api/admin/extensions uses the existing admin authentication and returns
`{ "extensions": [...] }` with `Cache-Control: no-store`. The server filters
`minRole` (staff by default); admin includes staff, owner includes both.
The endpoint rejects the API origin and configured ADMIN_ORIGIN values.
The browser also refuses its own origin.

The menu opens `/extensions?id=reports`. An optional `path=daily/list.html`
appends a relative path below the configured path. Only letters, digits,
underscores, hyphens, dotted filenames and directory separators are accepted.
Absolute paths, percent encoding, traversal, query strings and fragments are
rejected. Only a registered ID can create an iframe; a URL query parameter is
never used as a frame destination.

The frame uses a sandbox and no-referrer policy. Extensions must be trusted by
the deployment owner and hosted on a separate origin. They must allow embedding
by the admin origin using their own CSP frame-ancestors / X-Frame-Options
configuration. The host does not proxy the extension or bypass its restrictions.

The selected LINE account is informational context:

- Initial URL: `?lh_account=<selected account>`.
- Account changes reload the frame with updated context and send
  `{ type: 'lh:account-changed', accountId }` to the exact extension origin.
- The extension must validate message origin/source and authenticate and
  authorize every action itself. The account parameter is not authorization.

Admin session cookies, API keys, staff identity and role are not forwarded.
There is no login-ticket exchange, installation workflow, runtime module
loading, event-form field registration, DB migration or message sending.
This is a navigation convenience, not isolation for arbitrary untrusted code.

The sidebar and host page each read the list once per mount (at most two
additional authenticated GETs when both mount). There is no polling, retry
loop, cron, configuration DB access or server-side extension fetch. Existing
authentication can still perform its normal DB work. A list failure hides only
the extra menu; the host page shows an error without breaking other screens.

Removing the variable removes the extra menu after reload. Plugin data and
runtime remain owned by the independently operated extension.
