# PR Description — feat: booking confirmation + reminder via LINE or email

**Branch:** `feat/booking-notifications` (11 commits off `main`)
**Status:** All automated checks green (18/18 tests pass, build succeeds, typecheck clean for all new/modified files).

## Summary

- Send booking confirmation immediately after creation: LINE push when `friendId` present and friend still follows the bot; otherwise Resend email (CC `fixbox-biz@fixbox.jp`).
- Scheduled cron (every 5 min) sends 24h / 1h reminders through the same channel selector, idempotent via metadata flags (`reminder_24h_sent`, `reminder_1h_sent`).
- LIFF booking client now forwards the LINE Login email so bookings from non-friends can still receive email notifications.

## Prerequisites before shipping

Before this can function in production you must:

1. Create a Resend account; verify `fixbox.jp` DNS (SPF/DKIM).
2. Set Cloudflare Worker secrets:
   ```bash
   wrangler secret put RESEND_API_KEY
   wrangler secret put NOTIFY_FROM_EMAIL   # e.g. noreply@fixbox.jp
   ```
3. Deploy: `cd apps/worker && pnpm deploy`.

Without (1)/(2), the LINE path works but the email path silently skips (returns `delivered: false` — no crash, no fake success). The code guards the env reads.

## Architecture

- **Confirmation (best-effort):** `apps/worker/src/services/booking-notify.ts#sendBookingConfirmation` is called from `calendar.ts` inside a try/catch. Failures log `console.warn` and never fail the `POST /book` response.
- **Reminder (cron):** `processBookingReminders` runs in the existing scheduled handler, alongside `processStepDeliveries` / `processScheduledBroadcasts` / `processReminderDeliveries`. For each window (`-24h`, `-1h`, 10-min tolerance), it scans `calendar_bookings WHERE status='confirmed'` within `[now + offset, now + offset + 10min)`, sends, then marks the per-window flag in `metadata` JSON.
- **Delivery semantics:** at-least-once. If `updateBookingMetadata` fails after a successful send, the next cron tick (≤5 min later) will re-send within the 10-min window. Trade-off: duplicate reminder > missed reminder. Comment in `booking-notify.ts` documents this.
- **Channel selector:** `pickChannel({friendId, isFollowing, email})` returns `'line' | 'email' | 'none'`. LINE wins if following; email otherwise if present; `'none'` is counted as skipped.
- **JST formatting:** `formatJstRange` uses `+9h → getUTC*` so it works on Cloudflare's UTC runtime.

## Files

### New
- `apps/worker/src/services/email.ts` — Resend helper with default CC `fixbox-biz@fixbox.jp`
- `apps/worker/src/services/booking-notify.ts` — `pickChannel` / `sendBookingConfirmation` / `processBookingReminders` / JST formatter
- `apps/worker/src/services/__tests__/email.test.ts` — 4 tests
- `apps/worker/src/services/__tests__/booking-notify.test.ts` — 14 tests
- `apps/worker/vitest.config.ts`

### Modified
- `apps/worker/src/index.ts` — 2 new Env bindings + scheduled handler wiring
- `apps/worker/src/routes/calendar.ts` — `POST /book` accepts optional `email`; sends confirmation after insert
- `apps/worker/src/client/booking.ts` — forwards LIFF-decoded email into POST body
- `packages/db/src/calendar.ts` — `getBookingsForReminder` + `updateBookingMetadata`
- `apps/worker/package.json` — `vitest` dev dep + `test` script

## Manual test plan (post-deploy, owner to run)

### LINE path
- [ ] Open lineharness.vercel.app LIFF booking page as a test LINE friend.
- [ ] Pick a slot ≥ 2 hours in the future. Confirm.
- [ ] Expect: LINE flex bubble "予約が確定しました" arrives within seconds.
- [ ] Wait until T-1h of the booked slot. Within the next cron tick (≤5 min), expect a LINE text reminder "まもなく（1時間後）のご予約リマインダーです..."
- [ ] Verify `metadata.reminder_1h_sent = true` on the booking row:
  ```sql
  SELECT id, metadata FROM calendar_bookings WHERE id = '<booking_id>';
  ```

### Email path
- [ ] After Resend secrets are set, create a booking via curl with no friendId:
  ```bash
  curl -X POST https://<worker-host>/api/integrations/google-calendar/book \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "connectionId": "<conn_id>",
      "title": "テスト予約",
      "startAt": "<iso>",
      "endAt": "<iso>",
      "email": "y.otsuka@fixbox.jp"
    }'
  ```
- [ ] Expect: 201 response, email arrives at `y.otsuka@fixbox.jp` subject `【予約確定】M/D HH:MM〜HH:MM`
- [ ] Verify `Cc: fixbox-biz@fixbox.jp` header in Gmail UI + the fixbox-biz inbox received the same message.
- [ ] 1h before the booked time: email reminder arrives with `<br>` line breaks intact (not a single run-on line).

## Review signals

- Spec-compliance and code-quality reviewer subagents passed on every task in the plan.
- One Critical bug caught during review: `formatRange` used local timezone getters, which would have shown 01:00 JST (UTC) for a 10:00 JST slot on Cloudflare Workers. Fixed as `formatJstRange` in commit `f0098b5` with regression tests for JST/UTC/date-boundary cases.
- One Important bug caught during review: email reminder HTML collapsed newlines. Fixed in commit `c99794b` with regression-guard assertion.

## Commits (11)

```
c99794b fix(booking): reminder email newlines + at-least-once semantics docs + tests
4e61ad3 feat(booking): cron-driven reminders at -24h and -1h via LINE or email
c80d4ba refactor(db): use jstNow() for updated_at in updateBookingMetadata
eb4cd4d feat(db): add booking reminder scan and metadata update helpers
58faa40 feat(liff): forward authenticated email into booking POST
22f8250 test(booking): cover email confirmation and no-channel cases
f0098b5 fix(booking): format JST times independent of runtime TZ
93f3fe0 feat(booking): send confirmation via LINE or email on creation
9a6a0d6 feat(booking): accept optional email and persist in metadata
bd8229c feat: add Resend email helper with fixbox-biz CC default
f2ea73a docs: add booking notifications implementation plan
```
