# Integration keys

Settings → APIキー（外部連携） issues a separate `lhk_` credential for each integration.
Start with read; add write/send only when needed. UI defaults to 90 days. Copy the
plaintext once into the integration's secret setting. Do not put it into URLs or
browser storage. Old API/staff keys remain compatible; no automatic rotation or
revocation is performed. Confirm each consumer uses the replacement before revoking
its old key. Changing an MCP config does not reload an already running MCP process.

Keys store SHA-256, last4, scopes, issuer, timestamps and expiry/revocation. Bearer
only; never accepted as an admin cookie/login/session or extension ticket. A legacy
env API_KEY with the same prefix retains its original owner behavior. Human
owner/admin manage keys. Machine identities are distinct, never owner, and cannot
create other credentials. Owner-only route guards remain authoritative.

Scopes: read allows audited safe reads; write adds audited content mutations and
implies read; send allows individual delivery and broadcast creation/edit/send;
admin allows audited integration configuration (currently automations/account
settings, subject to existing owner guards). No scope automatically grants every
future route. `middleware/scopes.ts` is the registered-route allowlist; unknown/static
shadow routes default-deny. The initial allowlist deliberately excludes credential
management, secret-returning endpoints, raw LINE proxy and self-update; the proposal's
broad admin category is not an authorization bypass. Additional API families need
response/side-effect review before enabling. Templates/configuration can affect
later automated delivery; write/admin are not side-effect-free capabilities.

Responses use 403 insufficient_scope + required; human-only routes say required=human.
MCP annotations are descriptive hints, not enforcement. Actual enforcement is server
side. Successful non-read route requests log only machine ID, method, registered
route template and status, not query strings/IDs/message bodies/credentials.

Cost: existing legacy credential checks precede machine auth for compatibility (up
to two indexed staff lookups); then one UNIQUE hash lookup. last_used_at is a
conditional write at most once per five-minute timestamp window; concurrent attempts
may still issue multiple statements. List uses created_at/id index, limit<=100,
offset<=10,000. No full COUNT, cleanup cron or additional polling. Larger key sets
beyond this bounded UI page range need cursor pagination before expansion. Synthetic
100/10k/100k-key tests inspect real helper queries and an index-drop negative control;
production billed D1 rows/CPU are unmeasured.
