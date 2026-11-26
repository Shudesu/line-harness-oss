# Passkey and optional email login

Passkeys are an additional human login method. No API/Bearer keys are retired.
Server verification uses pinned @simplewebauthn/server 14.0.3; browser uses 14.0.0.
Documentation: https://simplewebauthn.dev/docs/packages/server . No custom signature
verification fallback is implemented. Synthetic ES256 authenticator tests exercise
real registration/authentication signatures, origin/RP/challenge/UV checks.

Configure a single HTTPS ADMIN_ORIGIN. RP ID defaults to its exact hostname;
WEBAUTHN_RP_ID must match that hostname (parent shared-domain RPs are refused in this
initial implementation). WEBAUTHN_ENABLED=false hides/disables enrollment/login.
UI support alone does not prove a real device works; browser automation is not used.
A domain change requires re-enrollment through another retained login method.

Enrollment requires cookie+CSRF and a real opaque login within 10 minutes; legacy
raw-cookie auto-upgrades do not count as reauthentication. User verification and
resident credentials are required; attestation=none, ES256/RS256 only. Account user
handle includes admin origin, RP ID, Worker origin and staff ID. The signed assertion
must return that exact discoverable user handle. It is not a role/tenant query hint.

Challenges store only a hash, are context-bound, expire after 5 minutes and are
atomically consumed. Counters update with an observed-counter CAS; fixed-zero
synced authenticators follow library semantics. Staff role/active/scopes are resolved
again at login. Atomic DB triggers delete staff passkeys on disable/delete. Env-owner
passkeys remain physical recovery methods across root API-key rotation; root API_KEY
must still be configured to bind the resulting session. Deleting a passkey blocks
future logins; existing sessions use the ordinary session revocation controls.

## Optional magic links

Disabled unless MAGIC_LINK_EMAIL_PROVIDER=resend with RESEND_API_KEY and
MAGIC_LINK_FROM, or provider=cloudflare with MAGIC_LINK_EMAIL send_email binding and
MAGIC_LINK_FROM. Sender must be a plain valid email address. Configure a verified
sender and authorized delivery in the chosen service separately. This implementation
creates no account/paid service/binding and sends no real test mail.

Only an unambiguous active staff email qualifies; no env-owner fallback. The response
is identical for known/unknown/disabled/ambiguous recipients, including delivery
failure. It is not a constant-time mailbox-enumeration guarantee: mail/network latency
may differ. Per-isolate limits: 20 requests/hour/IP, 5/hour/normalized email hash;
these are burst controls, not distributed global quotas. Public passkey options and
verification use separate 10/minute/IP limits. Production-wide abuse controls and
mail quotas should be configured before public enablement.

Links carry 32 random bytes in `/login/magic#t=...`; only SHA-256 is stored. Frontend
removes the fragment before POST. Links expire after 15 minutes and are atomically
single-use. Email changes, staff disable, duplicate identity, or credential rotation
between request and redemption refuse login. Delivery failures consume the token.
No credentials/tokens/email bodies in logs. Access to email is the authentication
factor; forwarded/stolen links grant that identity until expiry/use.

## Cost and migrations

088 adds credentials, challenges and staff lifecycle triggers; 089 adds email tokens.
Credential lookups are UNIQUE credential ID, staff lists use (staff_id,id) LIMIT 21.
Normal registration: bounded credential list + challenge INSERT; verify: challenge
PK read, conditional consume, bounded list and credential INSERT. Login: challenge PK
and credential UNIQUE reads, challenge CAS, counter CAS, staff PK read (except root),
session INSERT. Normal session validation stays on the shared auth path.

Email request: normalized-email index LIMIT 2 + token INSERT, one delivery request.
Consume: token-hash PK UPDATE RETURNING, normalized-email index LIMIT 2, session INSERT.
Existing six-hour maintenance deletes at most 100 expired challenge rows and 100
email-token rows via expiry indexes each run, no COUNT or new trigger frequency.
Expiry prevents reuse even if cleanup lags. Above 400 created rows/day per table,
retained expired rows can accumulate; capacity/cleanup cadence needs observed usage
before expanding public enrollment. Do not equate bounded query size with bounded
monthly spend. Production D1 billed rows/CPU and actual email delivery are unmeasured.
