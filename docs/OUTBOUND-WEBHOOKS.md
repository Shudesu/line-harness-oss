# Outbound webhook destinations

Automation `send_webhook` and ordinary outgoing webhooks use the same destination
checker at save and delivery time. Incoming webhook authentication is unchanged.

`OUTBOUND_URL_POLICY` is initially `warn`: an existing destination is retained and
unsafe URLs produce a reason-only warning. `enforce` refuses unsafe destinations;
`off` disables destination validation. Unknown nonempty policy values are treated
as enforce. The pre-existing HTTPS requirement for saving ordinary outgoing
webhooks remains in force even with warn/off.

The checker requires HTTPS, rejects URL credentials, non-public IPv4/IPv6 literals,
localhost/local/internal/lan names, unusual ports, and known Worker/admin/request
hosts. URL canonicalization also catches integer/short/octal IPv4 and IPv4-mapped
IPv6 loopback forms. `OUTBOUND_ALLOWED_PORTS` can add explicit ports.
`OUTBOUND_ALLOWED_HOSTS` restricts the allowed hosts further; for example,
`hooks.example.com,*.partner.example` permits the exact first host and subdomains
of the latter, not its apex or `badpartner.example`.

Delivery uses manual redirects and a 10-second abort signal. A non-2xx result is a
failure; the server does not retry or follow redirects. Existing redirecting
integrations should use the final HTTPS endpoint. Logs never include the URL,
query credentials, request payload or provider response body. Create/update
responses include `warnings` during the transition, and the automation UI displays
a warning after a compatible save. Reactivating a stored rule also validates its
effective destination.

This is URL-level validation, not DNS pinning: DNS rebinding and a hostname which
resolves to a private address cannot be ruled out by this checker. Prefer an
explicit allowlist of endpoints under your control. Warn mode is a migration aid,
not enforcement; no future date or release automatically flips this setting.

Policy configuration is carried through HTTP and scheduled work by request-scoped
AsyncLocalStorage, containing only the public policy fields. Event payloads cannot
override it. Synthetic concurrent-request tests and native workerd tests cover the
context boundary and redirect handling. This uses the existing `nodejs_compat`
flag, not a new service or binding.

Cost: destination parsing and policy checks add no DB calls. Reactivating an
existing automation with omitted actions adds one primary-key read to validate
the stored actions. Delivery count does not increase, redirects stop after the
first response, and no retry or polling is added. Existing event/automation log
writes are retained. Production CPU and billing rows have not been measured.

Runtime reference: https://developers.cloudflare.com/workers/runtime-apis/nodejs/asynclocalstorage/
