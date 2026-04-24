import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendBookingConfirmation, pickChannel, formatJstRange, processBookingReminders } from '../booking-notify.js';

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
      { GAS_MAIL_URL: undefined, GAS_MAIL_SECRET: undefined },
      fakeBooking,
      lineClient,
      friend as any,
    );

    expect(pushMessage).toHaveBeenCalledOnce();
    const [to, messages] = pushMessage.mock.calls[0];
    expect(to).toBe('U1');
    expect(messages[0].type).toBe('flex');
    expect(messages[0].altText).toContain('予約確定');
    // Regression guard: time must render in JST, not host TZ
    expect(messages[0].altText).toContain('10:00');
    expect(JSON.stringify(messages[0].contents)).toContain('10:00');
  });
});

describe('formatJstRange', () => {
  it('formats a 10:00 JST ISO as "10:00" regardless of host TZ', () => {
    const out = formatJstRange('2026-05-01T10:00:00+09:00', '2026-05-01T11:00:00+09:00');
    expect(out).toBe('5/1 10:00〜11:00');
  });

  it('handles UTC input by converting to JST', () => {
    // 01:00 UTC = 10:00 JST
    const out = formatJstRange('2026-05-01T01:00:00Z', '2026-05-01T02:00:00Z');
    expect(out).toBe('5/1 10:00〜11:00');
  });

  it('handles midnight JST crossing date boundary', () => {
    // 15:00 UTC = 00:00 JST next day
    const out = formatJstRange('2026-04-30T15:00:00Z', '2026-04-30T16:00:00Z');
    expect(out).toBe('5/1 00:00〜01:00');
  });
});

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
      { GAS_MAIL_URL: 'https://script.google.com/macros/s/TEST/exec', GAS_MAIL_SECRET: 'test-secret' },
      bookingWithEmail,
      lineClient,
      null,
    );

    expect(result.channel).toBe('email');
    expect(result.delivered).toBe(true);
    expect(pushMessage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.secret).toBe('test-secret');
    expect(body.to).toEqual(['user@example.com']);
    expect(body.cc).toEqual(['fixbox-biz@fixbox.jp']);
  });

  it('returns delivered=false when neither channel available', async () => {
    const pushMessage = vi.fn();
    const lineClient = { pushMessage } as any;
    const orphan: Booking = { ...fakeBooking, friend_id: null, metadata: null } as Booking;
    const result = await sendBookingConfirmation({ GAS_MAIL_URL: 'https://script.google.com/macros/s/TEST/exec', GAS_MAIL_SECRET: 'test-secret' }, orphan, lineClient, null);
    expect(result).toEqual({ channel: 'none', delivered: false });
  });
});

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
      { GAS_MAIL_URL: undefined, GAS_MAIL_SECRET: undefined },
      {
        now,
        db: {} as any,
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
      { GAS_MAIL_URL: undefined, GAS_MAIL_SECRET: undefined },
      {
        now,
        db: {} as any,
        lineClient: { pushMessage } as any,
        getBookingsForReminder: vi.fn().mockResolvedValue([booking]),
        updateBookingMetadata: vi.fn(),
        getFriendById: vi.fn(),
      } as any,
    );
    expect(summary.skipped).toBe(1);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  it('sends 1h email reminder with CC when booking has no friendId but has email', async () => {
    const now = new Date('2026-05-01T09:00:00+09:00');
    const booking = {
      id: 'b1h',
      connection_id: 'c1',
      friend_id: null,
      title: '予約',
      start_at: '2026-05-01T10:00:00+09:00',
      end_at: '2026-05-01T11:00:00+09:00',
      metadata: JSON.stringify({ email: 'customer@example.com' }),
    };

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email_r1' }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const pushMessage = vi.fn();
      const updateBookingMetadata = vi.fn().mockResolvedValue(undefined);
      const summary = await processBookingReminders(
        { GAS_MAIL_URL: 'https://script.google.com/macros/s/TEST/exec', GAS_MAIL_SECRET: 'test-secret' },
        {
          now,
          db: {} as any,
          lineClient: { pushMessage } as any,
          getBookingsForReminder: vi.fn().mockResolvedValue([booking]),
          updateBookingMetadata,
          getFriendById: vi.fn().mockResolvedValue(null),
        } as any,
      );

      expect(summary.delivered).toBe(1);
      expect(pushMessage).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.secret).toBe('test-secret');
      expect(body.to).toEqual(['customer@example.com']);
      expect(body.cc).toEqual(['fixbox-biz@fixbox.jp']);
      expect(body.html).toContain('<br>'); // newline conversion regression guard
      expect(updateBookingMetadata).toHaveBeenCalledWith(
        expect.anything(),
        'b1h',
        expect.objectContaining({ reminder_1h_sent: true, email: 'customer@example.com' }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('counts send failure as failed and does not mark metadata sent', async () => {
    const now = new Date('2026-04-30T10:00:00+09:00');
    const booking = {
      id: 'bfail',
      connection_id: 'c1',
      friend_id: 'f1',
      title: '予約',
      start_at: '2026-05-01T10:00:00+09:00',
      end_at: '2026-05-01T11:00:00+09:00',
      metadata: null as string | null,
    };
    const pushMessage = vi.fn().mockRejectedValue(new Error('LINE push 500'));
    const updateBookingMetadata = vi.fn();
    const summary = await processBookingReminders(
      { GAS_MAIL_URL: undefined, GAS_MAIL_SECRET: undefined },
      {
        now,
        db: {} as any,
        lineClient: { pushMessage } as any,
        getBookingsForReminder: vi.fn().mockResolvedValue([booking]),
        updateBookingMetadata,
        getFriendById: vi.fn().mockResolvedValue({
          id: 'f1', line_user_id: 'U1', is_following: 1,
        }),
      } as any,
    );
    expect(summary.failed).toBe(1);
    expect(summary.delivered).toBe(0);
    expect(updateBookingMetadata).not.toHaveBeenCalled();
  });
});
