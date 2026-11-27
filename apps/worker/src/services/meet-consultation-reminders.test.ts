import { describe, expect, it, vi } from 'vitest';
import {
  calculateMeetReminderSchedule,
  processDueMeetConsultationReminders,
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
    expect(text).toContain('まもなく開始');
    expect(text).toContain('https://meet.google.com/abc-defg-hij');
  });
});

describe('immediate Meet reminder dates', () => {
  it('does not call a same-day consultation tomorrow when its day-before reminder is sent immediately', () => {
    const startsAt = '2026-08-08T12:00:00.000Z';
    const now = new Date('2026-08-08T00:00:00.000Z');
    expect(calculateMeetReminderSchedule(startsAt, now)[0]).toEqual({
      kind: 'day_before', scheduledAt: now.toISOString(),
    });
    const text = renderMeetReminderText('day_before', startsAt, 'https://meet.google.com/abc-defg-hij');
    expect(text).toContain('8月8日（土）21:00から');
    expect(text).not.toContain('明日');
  });

  it('uses the actual date when a within-one-hour confirmation crosses JST midnight', () => {
    const startsAt = '2026-08-08T15:30:00.000Z';
    const now = new Date('2026-08-08T14:45:00.000Z');
    expect(calculateMeetReminderSchedule(startsAt, now)).toEqual([
      { kind: 'hour_before', scheduledAt: now.toISOString() },
    ]);
    const text = renderMeetReminderText('hour_before', startsAt, 'https://meet.google.com/abc-defg-hij');
    expect(text).toContain('8月9日（日）00:30から');
    expect(text).not.toContain('本日');
    expect(text).not.toContain('開始約1時間前');
  });

  it('keeps the payload identical when the same retry crosses midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime('2026-08-08T14:59:00.000Z');
      const before = renderMeetReminderText('hour_before', '2026-08-08T15:30:00.000Z', 'https://meet.google.com/abc-defg-hij');
      vi.setSystemTime('2026-08-08T15:01:00.000Z');
      const after = renderMeetReminderText('hour_before', '2026-08-08T15:30:00.000Z', 'https://meet.google.com/abc-defg-hij');
      expect(after).toBe(before);
    } finally {
      vi.useRealTimers();
    }
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
              async first() {
                const result = await this.all();
                return result.results[0] ?? null;
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
