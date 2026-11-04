import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import {
  cancelMeetConsultation,
  processDueMeetConsultationReminders,
  registerMeetConsultation,
  type RegisterMeetConsultationInput,
} from './meet-consultation-reminders.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const now = new Date('2026-08-08T00:00:00.000Z');
const later = new Date('2026-08-08T00:01:00.000Z');
const input: RegisterMeetConsultationInput = {
  externalEventId: 'calendar-event-1', friendId: 'friend-1', title: '個別相談',
  startsAt: '2026-08-08T12:00:00.000Z', endsAt: '2026-08-08T12:30:00.000Z',
  meetUrl: 'https://meet.google.com/abc-defg-hij',
};

interface ReminderRow { id: string; kind: string; status: string; retry_count: number }

describe('Meet consultation registration and delivery identity', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.pragma('foreign_keys = ON');
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('account', 'channel', '相談', 'local-token', 'local-secret');
      INSERT INTO friends (id, line_user_id, line_account_id)
        VALUES ('friend-1', 'LINE-1', 'account'), ('friend-2', 'LINE-2', 'account');
    `);
  });
  afterEach(() => fixture.sqlite.close());

  const rows = () => fixture.sqlite.prepare(
    'SELECT id, kind, status, retry_count FROM meet_consultation_reminders ORDER BY kind',
  ).all() as ReminderRow[];
  const process = (dispatch: (request: Request) => Promise<Response>, at = later) =>
    processDueMeetConsultationReminders(fixture.db, {
      now: at, proxyBaseUrl: 'https://local-proxy.example', proxyDispatch: dispatch,
    });

  // Simulate LINE's accepted retry keys without any external requests. A key
  // already accepted returns 409 even if a caller mistakenly changes payload.
  function acceptingProxy(loseFirstResponse = false) {
    const accepted = new Map<string, unknown>();
    const dispatch = vi.fn(async (request: Request) => {
      expect(request.headers.has('x-line-harness-source')).toBe(false);
      const key = request.headers.get('x-line-retry-key')!;
      const body = await request.json();
      if (accepted.has(key)) {
        return new Response('already accepted', {
          status: 409, headers: { 'x-line-accepted-request-id': 'original-request' },
        });
      }
      accepted.set(key, body);
      if (loseFirstResponse && accepted.size === 1) throw new Error('response lost after acceptance');
      return new Response('{}', { status: 200 });
    });
    return { accepted, dispatch };
  }

  it('delivers a changed schedule after the previous reminder was accepted', async () => {
    const registered = await registerMeetConsultation(fixture.db, input, now);
    const proxy = acceptingProxy();
    expect(await process(proxy.dispatch, now)).toEqual({ sent: 1, failed: 0 });
    const firstIds = rows().map(row => row.id);

    const changed = await registerMeetConsultation(fixture.db, {
      ...input, startsAt: '2026-08-08T13:00:00.000Z', endsAt: '2026-08-08T13:30:00.000Z',
    }, later);
    expect(changed.id).toBe(registered.id);
    expect(await process(proxy.dispatch)).toEqual({ sent: 1, failed: 0 });
    expect(proxy.accepted.size).toBe(2);
    const texts = Array.from(proxy.accepted.values()) as Array<{ messages: Array<{ text: string }> }>;
    expect(texts[0].messages[0].text).toContain('21:00');
    expect(texts[1].messages[0].text).toContain('22:00');
    expect(rows().every(row => !firstIds.includes(row.id))).toBe(true);
  });

  it('keeps the same key when an unchanged registration retries a lost response', async () => {
    await registerMeetConsultation(fixture.db, input, now);
    const initial = rows();
    const proxy = acceptingProxy(true);
    expect(await process(proxy.dispatch, now)).toEqual({ sent: 0, failed: 1 });
    await registerMeetConsultation(fixture.db, {
      ...input, startsAt: '2026-08-08T21:00:00+09:00', endsAt: '2026-08-08T21:30:00+09:00',
    }, later);
    expect(rows().map(row => row.id)).toEqual(initial.map(row => row.id));
    expect(await process(proxy.dispatch)).toEqual({ sent: 1, failed: 0 });
    expect(proxy.accepted.size).toBe(1);
    expect(rows().find(row => row.kind === 'day_before')?.status).toBe('sent');
  });

  it.each([
    { friendId: 'friend-2' }, { meetUrl: 'https://meet.google.com/xyz-abcd-efg' },
  ])('assigns new delivery keys for changed payload %j', async (change) => {
    await registerMeetConsultation(fixture.db, input, now);
    const firstIds = rows().map(row => row.id);
    await registerMeetConsultation(fixture.db, { ...input, ...change }, later);
    expect(rows()).toHaveLength(2);
    expect(rows().every(row => !firstIds.includes(row.id) && row.status === 'pending')).toBe(true);
  });

  it('assigns fresh keys when cancelled reminders are reactivated', async () => {
    await registerMeetConsultation(fixture.db, input, now);
    const firstIds = rows().map(row => row.id);
    expect(await cancelMeetConsultation(fixture.db, input.externalEventId, now)).toBe(true);
    expect(rows().every(row => row.status === 'cancelled')).toBe(true);
    await registerMeetConsultation(fixture.db, input, later);
    expect(rows().every(row => !firstIds.includes(row.id) && row.status === 'pending')).toBe(true);
  });

  it('cancels the redundant day-before reminder when moved within one hour', async () => {
    await registerMeetConsultation(fixture.db, input, now);
    const initialHour = rows().find(row => row.kind === 'hour_before')!;
    await registerMeetConsultation(fixture.db, {
      ...input, startsAt: '2026-08-08T00:30:00.000Z', endsAt: '2026-08-08T01:00:00.000Z',
    }, later);
    expect(rows().find(row => row.kind === 'day_before')?.status).toBe('cancelled');
    const hour = rows().find(row => row.kind === 'hour_before')!;
    expect(hour.status).toBe('pending');
    expect(hour.id).not.toBe(initialHour.id);
  });
});
