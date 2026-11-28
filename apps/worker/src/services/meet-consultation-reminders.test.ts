import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import {
  calculateMeetReminderSchedule,
  processDueMeetConsultationReminders,
  registerMeetConsultation,
  renderMeetReminderText,
} from './meet-consultation-reminders.js';

describe('calculateMeetReminderSchedule', () => {
  it('schedules the previous day and one hour before', () => {
    const now = new Date('2026-08-08T00:00:00.000Z');
    expect(calculateMeetReminderSchedule('2026-08-10T10:00:00.000Z', now)).toEqual([
      { kind: 'day_before', scheduledAt: '2026-08-09T10:00:00.000Z' },
      { kind: 'hour_before', scheduledAt: '2026-08-10T09:00:00.000Z' },
    ]);
  });

  it('sends the day-before reminder immediately when confirmed within 24 hours', () => {
    const now = new Date('2026-08-08T00:00:00.000Z');
    expect(calculateMeetReminderSchedule('2026-08-08T12:00:00.000Z', now)).toEqual([
      { kind: 'day_before', scheduledAt: '2026-08-08T00:00:00.000Z' },
      { kind: 'hour_before', scheduledAt: '2026-08-08T11:00:00.000Z' },
    ]);
  });

  it('does not send two messages together when confirmed within one hour', () => {
    const now = new Date('2026-08-08T00:00:00.000Z');
    expect(calculateMeetReminderSchedule('2026-08-08T00:30:00.000Z', now)).toEqual([
      { kind: 'hour_before', scheduledAt: '2026-08-08T00:00:00.000Z' },
    ]);
  });
});

describe('renderMeetReminderText', () => {
  it('renders the JST date and Meet URL', () => {
    const text = renderMeetReminderText(
      'hour_before',
      '2026-08-09T01:00:00.000Z',
      'https://meet.google.com/abc-defg-hij',
    );
    expect(text).toContain('8月9日（日）10:00');
    expect(text).toContain('開始約1時間前');
    expect(text).toContain('https://meet.google.com/abc-defg-hij');
  });
});

describe('processDueMeetConsultationReminders', () => {
  it('sends through the Harness proxy and marks the reminder sent', async () => {
    const updates: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async all() {
                if (!sql.includes('FROM meet_consultation_reminders r')) return { results: [] };
                return {
                  results: [{
                    id: '6db37bc2-f0c4-4fa8-baa6-5ec7069e1165',
                    consultation_id: 'consultation-1',
                    kind: 'hour_before',
                    retry_count: 0,
                    title: 'AI導入 個別相談',
                    starts_at: '2026-08-09T01:00:00.000Z',
                    meet_url: 'https://meet.google.com/abc-defg-hij',
                    line_user_id: 'U00000000000000000000000000000000',
                    channel_access_token: 'channel-token',
                  }],
                };
              },
              async run() {
                updates.push(args);
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const dispatch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://proxy.example.com/line-api/v2/bot/message/push');
      expect(request.headers.get('x-line-retry-key')).toBe(
        '6db37bc2-f0c4-4fa8-baa6-5ec7069e1165',
      );
      const body = await request.json() as { to: string; messages: Array<{ text: string }> };
      expect(body.to).toBe('U00000000000000000000000000000000');
      expect(body.messages[0].text).toContain('Google Meet');
      return new Response('{}', { status: 200 });
    });

    const result = await processDueMeetConsultationReminders(db, {
      now: new Date('2026-08-09T00:00:00.000Z'),
      proxyBaseUrl: 'https://proxy.example.com',
      proxyDispatch: dispatch,
    });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(updates).toContainEqual([
      '2026-08-09T00:00:00.000Z',
      '2026-08-09T00:00:00.000Z',
      '6db37bc2-f0c4-4fa8-baa6-5ec7069e1165',
    ]);
  });
});

describe('registerMeetConsultation', () => {
  const now = new Date('2026-08-08T00:00:00.000Z');
  const input = {
    externalEventId: 'google-event-1',
    friendId: 'friend-1',
    title: 'AI導入 個別相談',
    startsAt: '2026-08-10T10:00:00.000Z',
    endsAt: '2026-08-10T11:00:00.000Z',
    meetUrl: 'https://meet.google.com/abc-defg-hij',
  };

  function setup() {
    const { db, sqlite } = sqliteD1();
    sqlite.exec(readFileSync(new NodeURL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
    sqlite
      .prepare('INSERT INTO friends(id,line_user_id,display_name,is_following) VALUES(?,?,?,1)')
      .run('friend-1', 'U-meet', 'Meet Friend');
    const reminders = () => sqlite
      .prepare('SELECT id, kind, scheduled_at, status FROM meet_consultation_reminders ORDER BY kind')
      .all() as Array<{ id: string; kind: string; scheduled_at: string; status: string }>;
    return { db, sqlite, reminders };
  }

  // id は X-Line-Retry-Key として使われる。同じ id で新しい日時を送ると、
  // LINE が受理済み (409) と答え、新しい日時が届かないまま sent になる (#440)。
  it('gives rescheduled reminders a new id so LINE does not dedupe the new date', async () => {
    const { db, sqlite, reminders } = setup();
    await registerMeetConsultation(db, input, now);
    const before = reminders();
    sqlite.prepare("UPDATE meet_consultation_reminders SET status='sent', sent_at=?").run(now.toISOString());

    await registerMeetConsultation(db, {
      ...input,
      startsAt: '2026-08-11T10:00:00.000Z',
      endsAt: '2026-08-11T11:00:00.000Z',
    }, now);

    const after = reminders();
    expect(after.map((r) => [r.kind, r.scheduled_at, r.status])).toEqual([
      ['day_before', '2026-08-10T10:00:00.000Z', 'pending'],
      ['hour_before', '2026-08-11T09:00:00.000Z', 'pending'],
    ]);
    for (const reminder of after) {
      expect(before.map((r) => r.id)).not.toContain(reminder.id);
    }
  });

  it('keeps the id when an unchanged consultation is registered again after cancellation', async () => {
    const { db, sqlite, reminders } = setup();
    await registerMeetConsultation(db, input, now);
    const before = reminders();
    sqlite.prepare("UPDATE meet_consultation_reminders SET status='cancelled'").run();

    await registerMeetConsultation(db, input, now);

    const after = reminders();
    expect(after.map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it('does not touch reminders when the same schedule is registered again', async () => {
    const { db, sqlite, reminders } = setup();
    await registerMeetConsultation(db, input, now);
    sqlite.prepare("UPDATE meet_consultation_reminders SET status='sent'").run();
    const before = reminders();

    await registerMeetConsultation(db, input, now);

    expect(reminders()).toEqual(before);
  });
});
