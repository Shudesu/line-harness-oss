# Staff access policy

This compatibility-stage release keeps the existing role behavior by default.
Set `STAFF_ROLE_POLICY=strict` to enable the restricted staff policy. Explicit
`legacy` keeps existing integrations working; unknown nonempty values fail closed
as strict. Nothing changes the owner/admin roles or bypasses existing owner-only
guards. New limited API keys retain their independent default-deny scopes in both
modes.

| Operation | owner | admin | staff in strict mode |
|---|---|---|---|
| Friend/chat/conversation/inbox reads | yes | yes | yes |
| Individual reply, loading indicator, image upload | yes | yes | yes |
| Friend tags and metadata, chat notes/status | yes | yes | yes |
| Template/auto-reply reads | yes | yes | yes |
| Broadcast/scenario/forms/rich-menu/settings edits | yes | existing limits | no |
| Webhooks, automations, ad/conversion configuration | yes | existing limits | no |
| Raw LINE proxy using a staff key | yes | yes | no |
| Staff/key management and self-update | existing owner credentials | no | no |

Account metadata needed by the switcher remains readable without exposing tokens.
Public form definitions remain public; strict staff receives the public/redacted
representation. Explicit channel-token proxy authentication is unchanged.

The exact staff read/write route list lives in `middleware/staff-policy.ts`.
Production routes use `createAuthorizedRouter`, which prepends authorization to
the actual registered route (including nested/basePath routes). A new static path
cannot acquire a parameterized `:id` route's permission. Unknown protected routes
are denied in strict mode and to limited API keys. Normal HTTP/LINE identity gates
still run; this router is not a replacement for `authMiddleware`.

The admin hides administrative navigation for strict staff, disables template and
auto-reply management controls, and translates a role denial into a manager-help
message. UI/localStorage role values are only presentation hints; editing them
does not change Worker permissions.

Before enabling strict mode, verify any existing staff-key automation and move
administrative work to an appropriate admin credential. Do not assume an unknown
client is unused. Compatibility logging records a bounded, best-effort legacy
staff access attempt without keys or customer payloads. There is no automatic
release/date-based default flip and no automatic key revocation in this change.

Policy checks are in-memory route/role comparisons. They add no D1 queries, Cron,
polling, notifications or paid resources. Cookie CSRF protection is unchanged.
