# Workers Cache private pilot

Status: enabled for the default private test Worker only. Production remains disabled.

The Worker is a mixed public/private gateway. Its admin APIs use cookie authentication, so enabling cache globally without a response policy would be unsafe. The default policy is therefore deny-by-default:

- unmarked `/api/*`, `/admin/*`, webhook, and documentation responses become `private, no-store`
- other unmarked responses become `no-store`
- an existing explicit public policy is preserved

The first eligible public routes are immutable R2 images (`/images/:key`), QR output (`/api/qr`), version metadata, and webinar media that already sets a public cache policy. Signed/time-limited webinar responses that declare `private, no-store` remain excluded.

Before production enablement, verify cache status and hit rate on those routes, confirm authenticated endpoints always return `private, no-store`, and compare latency for the admin gateway. Production should remain off if the gateway lookup cost outweighs the public-media benefit.
