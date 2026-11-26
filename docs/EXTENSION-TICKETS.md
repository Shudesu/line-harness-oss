# Extension launch tickets

Minimal opt-in registry (the separate extension menu proposal is not assumed merged):
`ADMIN_EXTENSIONS=[{"id":"example","name":"Example","url":"https://extension.example","minRole":"admin","launch":"ticket"}]`.
Keep each >=32-byte secret in `ADMIN_EXTENSION_SECRETS={"example":"..."}` and the
matching extension server, never in frontend JS. Invalid/missing-key entries are
hidden. No implicit credential sharing. Registry URLs are HTTPS public addresses
through the outbound validator; no known self-host names are passed to that check
so a separately configured self-hosted extension is allowed. No outbound fetch by
the issuer occurs. DNS resolution/pinning is not claimed.

The launch API requires a human identity, role and cookie CSRF (legacy human Bearer
also works). The per-isolate burst limiter allows 30/staff/minute; it is not a global
quota. Tickets expire after 60 seconds, bind audience `lh-ext:id`, issuer Worker
origin and staff role. Account ID is a hint, never authorization. The core never
accepts tickets as credentials. Existing admin SSO format/code is not refactored.

The extensions page keeps tickets only in component memory and iframe URL fragment;
no local/session storage, query token or cookie forwarding. iframe uses no-referrer
and sandbox allow-scripts/allow-forms (no same-origin privilege). An extension may
need its own CORS handling for the opaque sandbox origin; do not weaken sandbox by
automatically adding same-origin/script capability on the admin origin.

On the extension **server**, import `verifyExtensionTicket` from `@line-harness/sdk`.
Pass the configured secret, exact extensionId/issuer and a mandatory `consumeJti`:

```ts
consumeJti: async payload => {
  const result = await db.prepare(
    'INSERT OR IGNORE INTO used_extension_tickets(issuer,audience,jti,expires_at) VALUES(?,?,?,?)'
  ).bind(payload.iss,payload.aud,payload.jti,payload.exp).run();
  return result.meta.changes === 1;
}
```

Use a UNIQUE/PRIMARY KEY(issuer,audience,jti), durable storage, atomic insertion and
indexed bounded expiry cleanup. Do not substitute an in-memory Set in production.
Verify before consuming, then issue the extension's own session. Remove the fragment
with history.replaceState after reading it; never echo tokens to logs or third parties.
Server verifier checks signature, issuer/audience, role, TTL, clock and replay callback.
Do not derive tenant authorization from an unverified query; per-tenant exact issuer
plus separate key is the boundary here. Shared-domain tenant extensions need an
explicit extra tenant binding before adoption.

No core DB/cron added. Costs are existing auth reads, bounded config parse and one
HMAC per launch. Replay storage is a mandatory separate extension responsibility.
No actual extension configuration, secret or external launch is registered by this change.
