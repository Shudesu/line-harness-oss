# Booking Notifications (Confirmation + Reminder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a calendar booking is created via `POST /api/integrations/google-calendar/book`, send a confirmation immediately and schedule a reminder 24h and 1h before `start_at`. Channel is chosen per booking: LINE if `friend_id` exists, otherwise email (CC fixbox-biz@fixbox.jp).

**Architecture:**
- Confirmation: fire-and-forget best-effort send inside the `book` route handler (after D1 insert, after GCal event creation).
- Reminder: piggyback on the existing Cloudflare Worker cron (`*/5 * * * *`). A new `processBookingReminders` scans `calendar_bookings` where `start_at` enters either the 24h or 1h window, sends the reminder through the appropriate channel, and persists the sent flags in `calendar_bookings.metadata` JSON to avoid duplicate sends. No new tables.
- Email: Resend HTTPS API (Cloudflare Workers compatible). CC is fixed to `fixbox-biz@fixbox.jp`. From/domain controlled via env var.
- Channel selection: if `friend_id` is present and the friend is still following → LINE. Otherwise if `metadata.email` is present → email. If neither → log warning, skip.

**Tech Stack:** Cloudflare Workers, Hono, D1, TypeScript, `@line-crm/line-sdk` (already wired), Resend REST API over `fetch` (no SDK, keeps bundle small).

---

## Prerequisites (human, outside the plan)

These must be completed by the owner before Task 3 runs — agent must stop and request user action if they are not done.

- Resend account created, `fixbox.jp` domain verified (SPF/DKIM).
- Secrets added to Cloudflare Worker:
  - `wrangler secret put RESEND_API_KEY`
  - `wrangler secret put NOTIFY_FROM_EMAIL` — e.g. `noreply@fixbox.jp`
- Branch created: `feat/booking-notifications` off `main` in `/Users/yuto/line-harness`.

---

## File Structure

**Create:**
- `apps/worker/src/services/booking-notify.ts` — single source of truth for confirmation + reminder send logic. Exports `sendBookingConfirmation(env, booking, friend)` and `processBookingReminders(env, lineClient)`.
- `apps/worker/src/services/email.ts` — thin wrapper over Resend `POST /emails`. Exports `sendEmail({ to, cc, subject, html, text })`. CC default hardcoded `fixbox-biz@fixbox.jp`.
- `apps/worker/src/services/__tests__/booking-notify.test.ts` — unit tests with mocked fetch / lineClient.
- `apps/worker/src/services/__tests__/email.test.ts` — unit tests with mocked fetch.

**Modify:**
- `apps/worker/src/index.ts` — extend `Env.Bindings` with `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`. Call `processBookingReminders` from the scheduled handler.
- `apps/worker/src/routes/calendar.ts` — extend `POST /book` payload to accept `email`, persist into `metadata.email`, invoke `sendBookingConfirmation` after successful insert (best effort, do not fail the booking on notify error).
- `apps/worker/src/client/booking.ts` — forward LIFF ID token email (when present) into the POST body.
- `packages/db/src/calendar.ts` — add `getBookingsForReminder(db, windowStart, windowEnd)` helper and `updateBookingMetadata(db, id, metadata)` helper.
- `apps/worker/package.json` — add `vitest` dev dep + `test` script (no existing worker tests).
- `apps/worker/vitest.config.ts` — new minimal vitest config.

---

## Task 1: Email helper with Resend + CC

**Files:**
- Create: `apps/worker/src/services/email.ts`
- Create: `apps/worker/src/services/__tests__/email.test.ts`
- Modify: `apps/worker/package.json` (add `vitest`, `test` script)
- Create: `apps/worker/vitest.config.ts`

- [ ] **Step 1: Add vitest dev dep and test script**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm add -D vitest @cloudflare/vitest-pool-workers
```

Edit `apps/worker/package.json` scripts block:

```json
"scripts": {
  "dev": "vite dev",
  "build": "vite build",
  "preview": "vite preview",
  "deploy": "vite build && wrangler deploy && wrangler triggers deploy",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

- [ ] **Step 2: Minimal vitest config**

Create `apps/worker/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Write the failing test for email helper**

Create `apps/worker/src/services/__tests__/email.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendEmail, DEFAULT_CC } from '../email.js';

describe('sendEmail', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_123' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('POSTs to Resend with CC fixbox-biz@fixbox.jp by default', async () => {
    await sendEmail({
      apiKey: 'test_key',
      from: 'noreply@fixbox.jp',
      to: 'mechanic@example.com',
      subject: '予約確定',
      html: '<p>OK</p>',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('noreply@fixbox.jp');
    expect(body.to).toEqual(['mechanic@example.com']);
    expect(body.cc).toEqual([DEFAULT_CC]);
    expect(DEFAULT_CC).toBe('fixbox-biz@fixbox.jp');
    expect(init.headers.Authorization).toBe('Bearer test_key');
  });

  it('allows overriding CC', async () => {
    await sendEmail({
      apiKey: 'k',
      from: 'a@b.c',
      to: 'x@y.z',
      cc: ['override@example.com'],
      subject: 's',
      html: '<p>h</p>',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.cc).toEqual(['override@example.com']);
  });

  it('throws on non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'rate_limited' }), { status: 429 }),
    );
    await expect(
      sendEmail({ apiKey: 'k', from: 'a@b.c', to: 'x@y.z', subject: 's', html: '<p>h</p>' }),
    ).rejects.toThrow(/rate_limited/);
  });

  it('sets AbortSignal timeout of 30s', async () => {
    await sendEmail({ apiKey: 'k', from: 'a@b.c', to: 'x@y.z', subject: 's', html: '<p>h</p>' });
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeDefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm test -- email.test
```

Expected: FAIL — `Cannot find module '../email.js'`.

- [ ] **Step 5: Implement email helper**

Create `apps/worker/src/services/email.ts`:

```typescript
export const DEFAULT_CC = 'fixbox-biz@fixbox.jp';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendEmailInput {
  apiKey: string;
  from: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const body = {
    from: input.from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    cc: input.cc ?? [DEFAULT_CC],
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
  };

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }

  return (await res.json()) as { id: string };
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm test -- email.test
```

Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/yuto/line-harness && git add apps/worker/src/services/email.ts apps/worker/src/services/__tests__/email.test.ts apps/worker/vitest.config.ts apps/worker/package.json pnpm-lock.yaml
git commit -m "feat: add Resend email helper with fixbox-biz CC default"
```

---

## Task 2: Extend Env + book route to accept email and persist it

**Files:**
- Modify: `apps/worker/src/index.ts:51-75` (Env.Bindings)
- Modify: `apps/worker/src/routes/calendar.ts:175-228` (POST /book handler)

- [ ] **Step 1: Add new env bindings**

Edit `apps/worker/src/index.ts` — extend `Env.Bindings` (after `MANAGED_AGENTS_BYPASS_TOKEN?: string;`):

```typescript
    MANAGED_AGENTS_BYPASS_TOKEN?: string;
    RESEND_API_KEY?: string;              // Resend — booking confirmation/reminder email
    NOTIFY_FROM_EMAIL?: string;           // e.g. noreply@fixbox.jp
```

- [ ] **Step 2: Extend POST /book payload with email**

In `apps/worker/src/routes/calendar.ts`, replace the body typing at line 177:

```typescript
    const body = await c.req.json<{
      connectionId: string;
      friendId?: string;
      title: string;
      startAt: string;
      endAt: string;
      description?: string;
      email?: string;
      metadata?: Record<string, unknown>;
    }>();
```

- [ ] **Step 3: Merge email into metadata before insert**

Replace lines 182-186 of `calendar.ts`:

```typescript
    const mergedMeta = {
      ...(body.metadata ?? {}),
      ...(body.email ? { email: body.email } : {}),
    };

    const booking = await createCalendarBooking(c.env.DB, {
      ...body,
      metadata: Object.keys(mergedMeta).length > 0 ? JSON.stringify(mergedMeta) : undefined,
    });
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/yuto/line-harness && git add apps/worker/src/index.ts apps/worker/src/routes/calendar.ts
git commit -m "feat(booking): accept optional email and persist in metadata"
```

---

## Task 3: Booking confirmation notification — channel selector + LINE path

**Files:**
- Create: `apps/worker/src/services/booking-notify.ts`
- Create: `apps/worker/src/services/__tests__/booking-notify.test.ts`
- Modify: `apps/worker/src/routes/calendar.ts` (invoke after insert)

- [ ] **Step 1: Write failing tests for channel selector + LINE confirmation**

Create `apps/worker/src/services/__tests__/booking-notify.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { sendBookingConfirmation, pickChannel } from '../booking-notify.js';

type Booking = Parameters<typeof sendBookingConfirmation>[1];

const fakeBooking: Booking = {
  id: 'b1',
  friend_id: 'f1',
  title: '予約',
  start_at: '2026-05-01T10:00:00+09:00',
  end_at: '2026-05-01T11:00:00+09:00',
  metadata: null,
} as Booking;

describe('pickChannel', () => {
  it('returns "line" when friend is following', () => {
    expect(pickChannel({ friendId: 'f1', isFollowing: true, email: null })).toBe('line');
  });
  it('returns "email" when no friendId but email exists', () => {
    expect(pickChannel({ friendId: null, isFollowing: false, email: 'x@y.z' })).toBe('email');
  });
  it('returns "email" when friend unfollowed and email exists', () => {
    expect(pickChannel({ friendId: 'f1', isFollowing: false, email: 'x@y.z' })).toBe('email');
  });
  it('returns "none" when neither channel is available', () => {
    expect(pickChannel({ friendId: null, isFollowing: false, email: null })).toBe('none');
  });
});

describe('sendBookingConfirmation (LINE path)', () => {
  it('pushes a LINE flex message to the friend', async () => {
    const pushMessage = vi.fn().mockResolvedValue({});
    const lineClient = { pushMessage } as unknown as Parameters<typeof sendBookingConfirmation>[2];
    const friend = { id: 'f1', line_user_id: 'U1', is_following: 1 };

    await sendBookingConfirmation(
      { RESEND_API_KEY: undefined, NOTIFY_FROM_EMAIL: undefined },
      fakeBooking,
      lineClient,
      friend as any,
    );

    expect(pushMessage).toHaveBeenCalledOnce();
    const [to, messages] = pushMessage.mock.calls[0];
    expect(to).toBe('U1');
    expect(messages[0].type).toBe('flex');
    expect(messages[0].altText).toContain('予約確定');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm test -- booking-notify.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement booking-notify (confirmation LINE path + channel selector)**

Create `apps/worker/src/services/booking-notify.ts`:

```typescript
import type { LineClient } from '@line-crm/line-sdk';
import type { Friend } from '@line-crm/db';
import { sendEmail } from './email.js';

export type Channel = 'line' | 'email' | 'none';

export interface ChannelInput {
  friendId: string | null;
  isFollowing: boolean;
  email: string | null;
}

export function pickChannel(input: ChannelInput): Channel {
  if (input.friendId && input.isFollowing) return 'line';
  if (input.email) return 'email';
  return 'none';
}

export interface BookingRow {
  id: string;
  friend_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  metadata: string | null;
}

export interface NotifyEnv {
  RESEND_API_KEY?: string;
  NOTIFY_FROM_EMAIL?: string;
}

export async function sendBookingConfirmation(
  env: NotifyEnv,
  booking: BookingRow,
  lineClient: LineClient,
  friend: Friend | null,
): Promise<{ channel: Channel; delivered: boolean }> {
  const meta = safeParseMetadata(booking.metadata);
  const channel = pickChannel({
    friendId: booking.friend_id,
    isFollowing: Boolean(friend?.is_following),
    email: meta.email ?? null,
  });

  if (channel === 'line' && friend) {
    const flex = buildConfirmationFlex(booking);
    await lineClient.pushMessage(friend.line_user_id, [
      { type: 'flex', altText: `【予約確定】${formatRange(booking)}`, contents: flex },
    ]);
    return { channel, delivered: true };
  }

  if (channel === 'email' && env.RESEND_API_KEY && env.NOTIFY_FROM_EMAIL && meta.email) {
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.NOTIFY_FROM_EMAIL,
      to: meta.email,
      subject: `【予約確定】${formatRange(booking)}`,
      html: buildConfirmationHtml(booking),
    });
    return { channel, delivered: true };
  }

  return { channel, delivered: false };
}

interface ParsedMeta { email?: string | null; reminder_24h_sent?: boolean; reminder_1h_sent?: boolean }

export function safeParseMetadata(raw: string | null): ParsedMeta {
  if (!raw) return {};
  try { return JSON.parse(raw) as ParsedMeta; } catch { return {}; }
}

function formatRange(b: BookingRow): string {
  const start = new Date(b.start_at);
  const end = new Date(b.end_at);
  const d = `${start.getMonth() + 1}/${start.getDate()}`;
  const hm = (x: Date) => `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  return `${d} ${hm(start)}〜${hm(end)}`;
}

function buildConfirmationFlex(b: BookingRow): unknown {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '予約が確定しました', weight: 'bold', size: 'lg' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: b.title, margin: 'md' },
        { type: 'text', text: formatRange(b), size: 'md', color: '#304070', weight: 'bold' },
        { type: 'text', text: '当日は担当者からご連絡します。', size: 'xs', color: '#888888', wrap: true, margin: 'md' },
      ],
    },
  };
}

function buildConfirmationHtml(b: BookingRow): string {
  return `<p>ご予約ありがとうございます。以下の内容で確定しました。</p>
<p><strong>${escapeHtml(b.title)}</strong><br>${escapeHtml(formatRange(b))}</p>
<p>当日は担当者からご連絡いたします。</p>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm test -- booking-notify.test
```

Expected: PASS (5 tests).

- [ ] **Step 5: Wire confirmation into POST /book**

Edit `apps/worker/src/routes/calendar.ts`. Add import at top:

```typescript
import { sendBookingConfirmation } from '../services/booking-notify.js';
import { LineClient } from '@line-crm/line-sdk';
import { getFriendById } from '@line-crm/db';
```

After the Google Calendar block (after line 209, before the `return c.json(...)` at line 211), insert:

```typescript
    // ベストエフォートで確定通知を送る — 失敗しても予約作成は成功として返す
    try {
      const friend = booking.friend_id ? await getFriendById(c.env.DB, booking.friend_id) : null;
      const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
      await sendBookingConfirmation(
        { RESEND_API_KEY: c.env.RESEND_API_KEY, NOTIFY_FROM_EMAIL: c.env.NOTIFY_FROM_EMAIL },
        booking,
        lineClient,
        friend,
      );
    } catch (err) {
      console.warn('booking confirmation notify failed (booking still created):', err);
    }
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/yuto/line-harness && git add apps/worker/src/services/booking-notify.ts apps/worker/src/services/__tests__/booking-notify.test.ts apps/worker/src/routes/calendar.ts
git commit -m "feat(booking): send confirmation via LINE or email on creation"
```

---

## Task 4: Booking confirmation — email path integration test

**Files:**
- Modify: `apps/worker/src/services/__tests__/booking-notify.test.ts`

- [ ] **Step 1: Add failing test for email path**

Append to `booking-notify.test.ts`:

```typescript
describe('sendBookingConfirmation (email path)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends email with CC fixbox-biz@fixbox.jp when friendId missing but email present', async () => {
    const pushMessage = vi.fn();
    const lineClient = { pushMessage } as any;
    const bookingWithEmail: Booking = {
      ...fakeBooking,
      friend_id: null,
      metadata: JSON.stringify({ email: 'user@example.com' }),
    } as Booking;

    const result = await sendBookingConfirmation(
      { RESEND_API_KEY: 'rk', NOTIFY_FROM_EMAIL: 'noreply@fixbox.jp' },
      bookingWithEmail,
      lineClient,
      null,
    );

    expect(result.channel).toBe('email');
    expect(result.delivered).toBe(true);
    expect(pushMessage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual(['user@example.com']);
    expect(body.cc).toEqual(['fixbox-biz@fixbox.jp']);
  });

  it('returns delivered=false when neither channel available', async () => {
    const pushMessage = vi.fn();
    const lineClient = { pushMessage } as any;
    const orphan: Booking = { ...fakeBooking, friend_id: null, metadata: null } as Booking;
    const result = await sendBookingConfirmation({ RESEND_API_KEY: 'rk', NOTIFY_FROM_EMAIL: 'a@b.c' }, orphan, lineClient, null);
    expect(result).toEqual({ channel: 'none', delivered: false });
  });
});
```

Add the missing imports at the top of the file:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 2: Run tests — should pass (implementation already covers both paths)**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm test -- booking-notify.test
```

Expected: PASS (7 tests total).

- [ ] **Step 3: Commit**

```bash
cd /Users/yuto/line-harness && git add apps/worker/src/services/__tests__/booking-notify.test.ts
git commit -m "test(booking): cover email confirmation and no-channel cases"
```

---

## Task 5: Forward LIFF email into booking POST

**Files:**
- Modify: `apps/worker/src/client/booking.ts:384-408`

- [ ] **Step 1: Pull email from decoded ID token and send it**

In `apps/worker/src/client/booking.ts`, after line 387 (`state.submitting = true;`), before the body build at line 396, add:

```typescript
    let bookerEmail: string | null = null;
    const decoded = liff.getDecodedIDToken?.();
    if (decoded?.email) {
      bookerEmail = decoded.email;
    }
```

Then extend the body block (replace lines 396-402):

```typescript
    const body: Record<string, unknown> = {
      title: `${profile.displayName}様 予約`,
      startAt: selectedSlot.startAt,
      endAt: selectedSlot.endAt,
    };
    if (CONNECTION_ID) body.connectionId = CONNECTION_ID;
    if (friendId) body.friendId = friendId;
    if (bookerEmail) body.email = bookerEmail;
```

- [ ] **Step 2: Build the LIFF bundle and typecheck**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm typecheck && pnpm build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/yuto/line-harness && git add apps/worker/src/client/booking.ts
git commit -m "feat(liff): forward authenticated email into booking POST"
```

---

## Task 6: DB helpers for reminder scan + metadata update

**Files:**
- Modify: `packages/db/src/calendar.ts` (or whichever file currently exports `getCalendarBookings` — confirm via grep first)

- [ ] **Step 1: Locate the current calendar DB module**

```bash
cd /Users/yuto/line-harness && grep -rn "export async function createCalendarBooking" packages/db/src/
```

Note the file path for subsequent steps.

- [ ] **Step 2: Add `getBookingsForReminder` and `updateBookingMetadata`**

Append to the calendar DB module:

```typescript
export interface ReminderScanOptions {
  /** ISO datetime — lower bound (inclusive) of start_at window */
  startFrom: string;
  /** ISO datetime — upper bound (exclusive) of start_at window */
  startTo: string;
}

export async function getBookingsForReminder(
  db: D1Database,
  opts: ReminderScanOptions,
): Promise<Array<{ id: string; connection_id: string; friend_id: string | null; title: string; start_at: string; end_at: string; metadata: string | null }>> {
  const result = await db
    .prepare(
      `SELECT id, connection_id, friend_id, title, start_at, end_at, metadata
       FROM calendar_bookings
       WHERE status = 'confirmed'
         AND start_at >= ?
         AND start_at < ?`,
    )
    .bind(opts.startFrom, opts.startTo)
    .all<{ id: string; connection_id: string; friend_id: string | null; title: string; start_at: string; end_at: string; metadata: string | null }>();
  return result.results;
}

export async function updateBookingMetadata(
  db: D1Database,
  id: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare(`UPDATE calendar_bookings SET metadata = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(metadata), new Date().toISOString(), id)
    .run();
}
```

Re-export both from `packages/db/src/index.ts` if that file uses a barrel export — verify with:

```bash
grep -n "getCalendarBookings" /Users/yuto/line-harness/packages/db/src/index.ts
```

and add the two new symbols next to it.

- [ ] **Step 3: Typecheck the db package**

```bash
cd /Users/yuto/line-harness/packages/db && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/yuto/line-harness && git add packages/db/src/
git commit -m "feat(db): add booking reminder scan and metadata update helpers"
```

---

## Task 7: Booking reminder cron — scan, send, mark sent

**Files:**
- Modify: `apps/worker/src/services/booking-notify.ts` (add `processBookingReminders`)
- Create/extend: `apps/worker/src/services/__tests__/booking-notify.test.ts` (new `describe` block)
- Modify: `apps/worker/src/index.ts` (scheduled handler invocation)

- [ ] **Step 1: Add failing test for the reminder scanner**

Append to `booking-notify.test.ts`:

```typescript
import { processBookingReminders } from '../booking-notify.js';

describe('processBookingReminders', () => {
  it('sends 24h reminder and marks metadata.reminder_24h_sent', async () => {
    const now = new Date('2026-04-30T10:00:00+09:00');
    const booking = {
      id: 'b24',
      connection_id: 'c1',
      friend_id: 'f1',
      title: '予約',
      start_at: '2026-05-01T10:00:00+09:00',
      end_at: '2026-05-01T11:00:00+09:00',
      metadata: null as string | null,
    };
    const getBookingsForReminder = vi.fn().mockResolvedValue([booking]);
    const updateBookingMetadata = vi.fn().mockResolvedValue(undefined);
    const getFriendById = vi.fn().mockResolvedValue({
      id: 'f1', line_user_id: 'U1', is_following: 1,
    });
    const pushMessage = vi.fn().mockResolvedValue({});
    const lineClient = { pushMessage } as any;

    const summary = await processBookingReminders(
      { RESEND_API_KEY: undefined, NOTIFY_FROM_EMAIL: undefined },
      {
        now,
        lineClient,
        getBookingsForReminder,
        updateBookingMetadata,
        getFriendById,
      } as any,
    );

    expect(summary.delivered).toBe(1);
    expect(pushMessage).toHaveBeenCalledOnce();
    expect(updateBookingMetadata).toHaveBeenCalledWith(
      expect.anything(),
      'b24',
      expect.objectContaining({ reminder_24h_sent: true }),
    );
  });

  it('skips booking where reminder_24h_sent is already true', async () => {
    const now = new Date('2026-04-30T10:00:00+09:00');
    const booking = {
      id: 'b24b',
      connection_id: 'c1',
      friend_id: 'f1',
      title: '予約',
      start_at: '2026-05-01T10:00:00+09:00',
      end_at: '2026-05-01T11:00:00+09:00',
      metadata: JSON.stringify({ reminder_24h_sent: true }),
    };
    const pushMessage = vi.fn();
    const summary = await processBookingReminders(
      { RESEND_API_KEY: undefined, NOTIFY_FROM_EMAIL: undefined },
      {
        now,
        lineClient: { pushMessage } as any,
        getBookingsForReminder: vi.fn().mockResolvedValue([booking]),
        updateBookingMetadata: vi.fn(),
        getFriendById: vi.fn(),
      } as any,
    );
    expect(summary.skipped).toBe(1);
    expect(pushMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — must fail**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm test -- booking-notify.test
```

Expected: FAIL — `processBookingReminders` not exported.

- [ ] **Step 3: Implement the reminder scanner**

Append to `apps/worker/src/services/booking-notify.ts`:

```typescript
export interface ReminderDeps {
  now: Date;
  lineClient: LineClient;
  db: D1Database;
  getBookingsForReminder: (db: D1Database, opts: { startFrom: string; startTo: string }) => Promise<BookingRow[]>;
  updateBookingMetadata: (db: D1Database, id: string, metadata: Record<string, unknown>) => Promise<void>;
  getFriendById: (db: D1Database, id: string) => Promise<Friend | null>;
}

interface WindowSpec {
  label: '24h' | '1h';
  /** metadata flag key */
  flag: 'reminder_24h_sent' | 'reminder_1h_sent';
  /** minutes before start_at where window begins */
  beforeStartMin: number;
  /** window length in minutes (tolerance for cron tick) */
  windowMin: number;
}

const WINDOWS: WindowSpec[] = [
  { label: '24h', flag: 'reminder_24h_sent', beforeStartMin: 24 * 60, windowMin: 10 },
  { label: '1h',  flag: 'reminder_1h_sent',  beforeStartMin: 60,      windowMin: 10 },
];

export async function processBookingReminders(
  env: NotifyEnv,
  deps: ReminderDeps,
): Promise<{ delivered: number; skipped: number; failed: number }> {
  let delivered = 0, skipped = 0, failed = 0;

  for (const w of WINDOWS) {
    const windowStart = new Date(deps.now.getTime() + w.beforeStartMin * 60_000);
    const windowEnd = new Date(windowStart.getTime() + w.windowMin * 60_000);
    const rows = await deps.getBookingsForReminder(deps.db, {
      startFrom: windowStart.toISOString(),
      startTo: windowEnd.toISOString(),
    });

    for (const b of rows) {
      const meta = safeParseMetadata(b.metadata);
      if (meta[w.flag]) { skipped++; continue; }

      try {
        const friend = b.friend_id ? await deps.getFriendById(deps.db, b.friend_id) : null;
        const channel = pickChannel({
          friendId: b.friend_id,
          isFollowing: Boolean(friend?.is_following),
          email: meta.email ?? null,
        });

        if (channel === 'line' && friend) {
          await deps.lineClient.pushMessage(friend.line_user_id, [
            { type: 'text', text: buildReminderText(b, w.label) },
          ]);
        } else if (channel === 'email' && env.RESEND_API_KEY && env.NOTIFY_FROM_EMAIL && meta.email) {
          await sendEmail({
            apiKey: env.RESEND_API_KEY,
            from: env.NOTIFY_FROM_EMAIL,
            to: meta.email,
            subject: `【リマインダー】${formatRange(b)} の予約`,
            html: `<p>${escapeHtml(buildReminderText(b, w.label))}</p>`,
          });
        } else {
          skipped++;
          continue;
        }

        await deps.updateBookingMetadata(deps.db, b.id, { ...meta, [w.flag]: true });
        delivered++;
      } catch (err) {
        console.warn(`booking reminder failed for ${b.id}:`, err);
        failed++;
      }
    }
  }

  return { delivered, skipped, failed };
}

function buildReminderText(b: BookingRow, label: '24h' | '1h'): string {
  const lead = label === '24h' ? '明日' : 'まもなく（1時間後）';
  return `${lead}のご予約リマインダーです。\n${b.title}\n${formatRange(b)}\n\nご都合が変わった場合はこのトークからご連絡ください。`;
}
```

Fix the test dependency signature — the test passes `{ now, lineClient, getBookingsForReminder, updateBookingMetadata, getFriendById }` but not `db`. Update the test to include `db: {} as any,` in the deps object for both tests.

- [ ] **Step 4: Run tests — must pass**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm test -- booking-notify.test
```

Expected: PASS (9 tests).

- [ ] **Step 5: Wire into the scheduled handler**

Edit `apps/worker/src/index.ts`. Add import near the other service imports:

```typescript
import { processBookingReminders } from './services/booking-notify.js';
import { getBookingsForReminder, updateBookingMetadata, getFriendById } from '@line-crm/db';
```

Then inside the `scheduled` handler, alongside the existing `processReminderDeliveries(env.DB, defaultLineClient)` call (around line 362), add:

```typescript
    processBookingReminders(
      { RESEND_API_KEY: env.RESEND_API_KEY, NOTIFY_FROM_EMAIL: env.NOTIFY_FROM_EMAIL },
      {
        now: new Date(),
        db: env.DB,
        lineClient: defaultLineClient,
        getBookingsForReminder,
        updateBookingMetadata,
        getFriendById,
      },
    ),
```

(Insert it inside the same `jobs.push(Promise.all([...]))` array so it runs concurrently.)

- [ ] **Step 6: Typecheck and build**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm typecheck && pnpm build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/yuto/line-harness && git add apps/worker/src/services/booking-notify.ts apps/worker/src/services/__tests__/booking-notify.test.ts apps/worker/src/index.ts
git commit -m "feat(booking): cron-driven reminders at -24h and -1h via LINE or email"
```

---

## Task 8: End-to-end smoke verification

**Files:** none (manual verification)

- [ ] **Step 1: Deploy to Cloudflare**

```bash
cd /Users/yuto/line-harness/apps/worker && pnpm deploy
```

Expected: deploy succeeds, `wrangler triggers deploy` confirms cron `*/5 * * * *`.

- [ ] **Step 2: LINE path — create a booking**

1. Open lineharness.vercel.app booking LIFF as a test LINE friend.
2. Pick a slot ≥ 2 hours in the future.
3. Confirm — observe LINE receives the "予約確定" flex bubble within seconds.

Expected: flex bubble arrives. Record the booking id from `GET /api/integrations/google-calendar/bookings?friendId=<your_friend_id>`.

- [ ] **Step 3: LINE path — reminder**

Pick a slot ~65 minutes out (to land inside the 1h window on next cron tick). Wait until 60 min before start passes; next cron tick (≤5 min later) should push the 1h reminder. Verify `metadata.reminder_1h_sent = true` on the booking row.

- [ ] **Step 4: Email path — create booking without friendId**

```bash
curl -X POST https://<worker-host>/api/integrations/google-calendar/book \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "<conn_id>",
    "title": "テスト予約",
    "startAt": "2026-05-01T10:00:00+09:00",
    "endAt":   "2026-05-01T11:00:00+09:00",
    "email":   "y.otsuka@fixbox.jp"
  }'
```

Expected: 201. Email arrives at y.otsuka@fixbox.jp with CC fixbox-biz@fixbox.jp visible in the Gmail UI.

- [ ] **Step 5: Verify CC header in email**

Open the received email headers, confirm `Cc: fixbox-biz@fixbox.jp`. Confirm fixbox-biz@fixbox.jp inbox also received the message.

- [ ] **Step 6: Push and open PR**

```bash
cd /Users/yuto/line-harness && git push -u origin feat/booking-notifications
gh pr create --title "feat(booking): confirmation + reminder via LINE or email" --body "$(cat <<'EOF'
## Summary
- Send booking confirmation immediately after creation: LINE push when friendId present, Resend email otherwise (CC fixbox-biz@fixbox.jp).
- Scheduled cron sends 24h / 1h reminders through the same channel selector, idempotent via metadata flags.
- LIFF booking client now forwards the LINE Login email so no-friend bookings can still get notified.

## Test plan
- [x] Unit tests pass (`pnpm test` in apps/worker)
- [ ] Manual: LINE confirmation flex arrives on new booking
- [ ] Manual: 1h LINE reminder fires within next cron tick
- [ ] Manual: no-friendId booking with `email` triggers Resend email with CC fixbox-biz@fixbox.jp
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- "確定連絡が飛ぶか" → Task 3 (LINE) + Task 4 (email). ✅
- "リマインダーが飛ぶか" → Task 7 (LINE + email via cron). ✅
- "friendId あれば LINE、なければメール" → `pickChannel` in Task 3. ✅
- "メールの CC に fixbox-biz@fixbox.jp" → Task 1 (`DEFAULT_CC`) used in Task 3/4/7. ✅

**Placeholder scan:** No TBD / TODO / "similar to above" present.

**Type consistency:** `BookingRow`, `NotifyEnv`, `ReminderDeps` used consistently across Tasks 3, 4, 7. `pickChannel` signature matches in both usages. `sendEmail` signature consistent in Task 1 and Task 7.

**Known risk:** LIFF booking currently calls `liff.getDecodedIDToken` — requires `scope=profile openid email` on login. `liff.ts:91` already sets this. Non-LIFF bookings must pass `email` in the POST body explicitly.
