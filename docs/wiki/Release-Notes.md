# Release Notes

## v0.21.2 (2026-08-14)

### Added — Rich menu initial display

- Rich menus can now choose whether LINE opens the menu automatically when a friend enters the chat.
- The setting is available on both the new-menu and edit screens and is applied the next time the menu is registered with LINE.
- Existing menus retain the previous OFF behavior; newly created menus default to ON in the Admin UI.

### Fixed — Admin update uploads

- Cloudflare Pages asset uploads now use the same top-level JSON array format as Wrangler, fixing opaque HTTP 500 failures when the Admin update contains uncached assets.
- Upload batches are bounded by both file count and 40 MiB of source data, with up to five retries for HTTP 429 and 5xx responses.

### Database

- Additive migration `069_rich_menu_selected.sql` stores the LINE rich-menu `selected` setting.

## v0.21.1 (2026-08-14)

### Fixed — Webinar analytics and registration delivery

- The recent-participants table now keeps the all-time session count while showing watch progress, CTA activity, and form completion from the participant's latest session only.
- Worker and Admin remain compatible during rolling updates, preventing `NaN:NaN` and `NaN%` when either side still uses the previous analytics field name.
- Repeated taps or retried requests for the same webinar session no longer send duplicate LINE registration confirmations.
- Added regression coverage for latest-session analytics and idempotent registration delivery.

### Database

- No migration required.

## v0.21.0 (2026-08-14)

### Added — Live CTA consultation booking

- After submitting a webinar CTA form, viewers can choose a real-time available consultation slot without leaving the live screen.
- Availability starts from the staff member's recurring LINE Harness hours, then removes dated overrides, existing bookings, Google Calendar busy periods, and slots inside the lead-time window.
- A confirmed booking creates a Google Calendar event and Google Meet link, registers the consultation, and schedules LINE reminders for the previous day and one hour before the meeting.
- Staff can connect their own Google account through OAuth. Service-account keys and calendar sharing are no longer required for new installations.
- OAuth requests only `calendar.events` and `calendar.events.freebusy`, avoiding unrelated Drive or YouTube grants.
- Setup and troubleshooting are documented in [Google Calendar & Webinar Booking](28-Google-Calendar-and-Webinar-Booking.md).

### Added — Messaging and inquiry improvements

- Friend-specific scenario and auto-reply deliveries can replace `{{liff_id}}` with the sending account's LIFF ID.
- Sending `マイル` to any connected LINE account returns the user's mileage wallet through a quota-saving reply message.
- Media inquiries can be stored in D1 with notification delivery status for operational follow-up.

### Fixed

- Immediate first-step delivery now evaluates the same step conditions as scheduled delivery.
- The chat list uses the true latest message for previews, ordering, and pagination, including messages sent through the LINE Harness proxy.

### Database

- Additive migrations `067_mileage_keyword_auto_reply.sql` and `068_media_inquiries.sql`.

## v0.20.0 (2026-08-10)

### Added — Mileage economy

- A shared, cross-account mileage ledger with idempotent grants, reversals, spending, expiration, adjustments, configurable rules, daily caps, asynchronous processing, and admin reporting.
- Mileage rewards for LINE activity, bookings, form submissions, tracked-link clicks, purchases, tags, webinar viewing/completion/CTA clicks, Instagram engagement, and long-term follow status.
- Quality-based referral mileage that rewards downstream actions by referred friends instead of raw friend-add counts alone.
- A self-service LIFF wallet showing cross-account balances, credited LINE accounts, earning opportunities, referral offers, and accordion-style mileage history.
- HMAC-signed, short-lived cross-account linking so users can safely consolidate mileage across multiple LINE Official Accounts.

### Added — Webinar and consultation automation

- Webinar funnel events, journey follow-ups, mileage processing, and follow-up scheduling.
- Google Calendar availability synchronization and Google Meet consultation reminders.

### Database

- Additive migrations `051_booking_recurring_availability_google_calendar.sql` and `057` through `066` for webinar journeys, reminders, mileage, loyalty, and quality referrals.

## v0.17.0 (2026-07-08)

### Added — Link-tracking controls

- **Per-account LIFF resolution for /t links** — new `tracked_links.line_account_id` (migration 046). The identify-redirect for /t links opened inside the LINE app now uses the LIFF of the account that owns the link (previously the global `LIFF_URL`, which could show another account's consent screen). Fallback order: `line_account_id` → the linked scenario's account → `env.LIFF_URL`. OGP resolution follows the same order.
- **Per-broadcast link shortening toggle** — `broadcasts.track_links` (default ON). A checkbox on the broadcast form and draft/schedule detail lets you turn click tracking off per message; when off, URLs are sent as-is (no /t/ conversion, no text→flex rewrite).
- **API / MCP support** — `trackLinks` on `POST/PUT /api/broadcasts` and `POST /api/friends/:id/messages`; MCP `broadcast` / `send_message` gain `trackLinks`, `create_tracked_link` / `manage_tracked_links` gain `accountId`.
- Auto-tracked links now record the sending account; friends API returns `lineAccountId`.

### Added — Installer / self-update overhaul

`npx create-line-harness` installs are now version-stamped official releases, and automatic updates actually work. This is the first release built with the new pipeline.

- **Setup deploys from the official release bundle** — the Worker ships the release artifact byte-for-byte (so `/admin/version` reports the real version and fork detection recognizes the install as vanilla), and the admin UI is unpacked from the bundle instead of a local Next.js build (much faster setup). The clone is pinned to the release tag so schema/migrations always match the deployed code. A `--from-source` flag keeps the old behaviour for development.
- **Adoption path for older CLI installs (`v0.0.0-dev`)** — running `npx create-line-harness@latest update` now offers, with an explicit confirmation prompt, to move the install onto the latest official release. Database contents, settings, and secrets are preserved.
- **Update-flow fixes** — the admin bundle's `__LH_WORKER_URL__` placeholder is now materialized before deploy (previously an update would break the dashboard), `nodejs_compat` is preserved on Worker uploads, Workers Assets survive script updates, LIFF-Pages-less installs are supported, and already-applied migrations are skipped instead of aborting the update. The dashboard's self-update flow receives the same fixes.
- **Deployable release bundles** — previous bundles shipped a worker stub without its actual code, and the manifest hash could never match the bundled bytes. The release pipeline now builds the worker with wrangler (the same path every real deployment uses) and publishes a detached `worker_bundle_hash` for download verification. Bundles from older releases are explicitly rejected.
- **Docs** — the manual update guide (26-Manual-Update) now covers CLI installs; `wrangler d1 migrations apply` (which does not work for CLI installs) was replaced with a per-file `d1 execute --file` procedure.

## v0.16.0 (2026-07-07)

### Added — Affiliate tracking (ASP)

Self-serve affiliate tracking with a full funnel timeline (click → friend add → form/booking → payment).

- **Self-serve links** — affiliates register and issue links from LIFF (`?page=affiliate`): 6-char random slugs, up to 20 links, per-channel labels. Admins can also create affiliates from the dashboard (server-generated random codes, 1:1 friend binding).
- **Offers** — define campaigns with a fixed reward per conversion. Affiliates enroll per offer and get offer-specific links; offer tags/scenarios are applied automatically on inflow (paused offers stop the flow, measurement continues).
- **Last-touch attribution** — the latest affiliate touch within a 90-day window is snapshotted at conversion time (self-clicks excluded). The full touch history stays queryable in `ref_tracking`.
- **Approval flow** — attributed conversions start as `pending`; approve/reject from the dashboard. Confirmed reward = approved count × fixed amount, with identity-key duplicate flags for fraud review.
- **Push notifications** — affiliates get a LINE push on new referred friend adds and on approval (double-send prevented at the DB level).
- **Journey APIs** — `GET /api/friends/:id/journey` and per-affiliate journeys with cursor pagination.
- **Short link domain** — `LINK_BASE_URL` account setting + a redirect rule on your domain yields `https://<your-domain>/<slug>` links.
- Admin UI consolidated into one `/affiliates` page with three tabs (affiliates / offers / approvals); the LIFF page follows the booking form design language.

### Added — iOS proxy booking

- Admin proxy booking and availability routes for the iOS app flow.

### Improved — Chat & inbox

- **~8x faster chat list** — replaced triple `messages_log` scans with argmax aggregation and added cursor pagination (production: 3,473ms → 435ms).
- **Unanswered badge** — conversations marked resolved are excluded (auto-revive on new inbound); instant refresh after replies/status changes; non-text inbound (images/stickers) now marks chats unread.
- The same resolved exclusion now applies to `/api/conversations` and the MCP `list_conversations` tool.

### Fixed

- Booking reminders run before heavy scheduled jobs (prevents cron-starvation misses) and after token refresh.
- `/o` share URLs return OGP HTML to link-preview bots; cross-account OGP fallback leak fixed.
- Update banner: hidden for builds without embedded versions (self-hosted CI/CD), softer fork wording, manual-update guide link fixed (`docs/wiki/26-Manual-Update.md`).
- `/updates` page shows guidance instead of "Failed to fetch" when self-update is not configured.

### Database

- Migrations `046_affiliate_links.sql` and `047_affiliate_offers.sql` (both additive; 047 backfills `pending` for existing attributed conversions).

## v0.14.1 (2026-05-20)

Patch release for the OSS sync line from the private `line-harness` repository.

### Changed

- Synced the latest allowlisted worker updates from private `line-harness` into `line-harness-oss`.
- Kept OSS-specific CI and regression guards intact during the sync.
- Cleaned up update-route typing and removed unused LIFF event booking aliases.

### Verification

- `pnpm --filter worker typecheck`
- `pnpm --filter worker test`
- `pnpm --filter worker build`

### Notes

- The sync does not delete OSS-only files. Paths reported by `harness-oss-sync` as `would_delete_manual` remain manual review items.
- Private uncommitted reminder-dedup work was not included; this release was prepared from private `HEAD`.
