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
    expect(messages[0].altText).toContain('【面談確定】');
    // Regression guard: time must render in JST, not host TZ
    expect(messages[0].altText).toContain('10:00');
    const contentsJson = JSON.stringify(messages[0].contents);
    expect(contentsJson).toContain('10:00');
    expect(contentsJson).toContain('整備士面談');
  });

  it('includes Google Meet URL + footer button when metadata.meet_url is set', async () => {
    const pushMessage = vi.fn().mockResolvedValue({});
    const lineClient = { pushMessage } as unknown as Parameters<typeof sendBookingConfirmation>[2];
    const friend = { id: 'f1', line_user_id: 'U1', is_following: 1 };
    const bookingWithMeet: Booking = {
      ...fakeBooking,
      metadata: JSON.stringify({ meet_url: 'https://meet.google.com/abc-defg-hij' }),
    } as Booking;

    await sendBookingConfirmation(
      { GAS_MAIL_URL: undefined, GAS_MAIL_SECRET: undefined },
      bookingWithMeet,
      lineClient,
      friend as any,
    );

    const [, messages] = pushMessage.mock.calls[0];
    const contents = messages[0].contents;
    const contentsJson = JSON.stringify(contents);
    expect(contentsJson).toContain('https://meet.google.com/abc-defg-hij');
    expect(contents.footer).toBeDefined();
    expect(JSON.stringify(contents.footer)).toContain('Google Meetを開く');
  });

  it('omits footer when meet_url is absent', async () => {
    const pushMessage = vi.fn().mockResolvedValue({});
    const lineClient = { pushMessage } as unknown as Parameters<typeof sendBookingConfirmation>[2];
    const friend = { id: 'f1', line_user_id: 'U1', is_following: 1 };

    await sendBookingConfirmation(
      { GAS_MAIL_URL: undefined, GAS_MAIL_SECRET: undefined },
      fakeBooking,
      lineClient,
      friend as any,
    );

    const [, messages] = pushMessage.mock.calls[0];
    expect(messages[0].contents.footer).toBeUndefined();
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

  it('sends email without cc when NOTIFY_CC_EMAIL is unset', async () => {
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
    expect(body.cc).toBeUndefined();
    expect(body.subject).toContain('Fixx｜整備士面談');
    expect(body.subject).toContain('10:00');
    expect(body.html).toContain('整備士面談のご予約をいただき');
  });

  it('sends confirmation with meet_url when metadata.meet_url is set', async () => {
    const pushMessage = vi.fn();
    const lineClient = { pushMessage } as any;
    const bookingWithMeet: Booking = {
      ...fakeBooking,
      friend_id: null,
      metadata: JSON.stringify({
        email: 'user@example.com',
        meet_url: 'https://meet.google.com/abc-defg-hij',
      }),
    } as Booking;

    await sendBookingConfirmation(
      { GAS_MAIL_URL: 'https://script.google.com/macros/s/TEST/exec', GAS_MAIL_SECRET: 'test-secret' },
      bookingWithMeet,
      lineClient,
      null,
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain('https://meet.google.com/abc-defg-hij');
    expect(body.html).toContain('<a href="https://meet.google.com/abc-defg-hij">');
  });

  it('sends email with cc when NOTIFY_CC_EMAIL is set', async () => {
    const pushMessage = vi.fn();
    const lineClient = { pushMessage } as any;
    const bookingWithEmail: Booking = {
      ...fakeBooking,
      friend_id: null,
      metadata: JSON.stringify({ email: 'user@example.com' }),
    } as Booking;

    const result = await sendBookingConfirmation(
      {
        GAS_MAIL_URL: 'https://script.google.com/macros/s/TEST/exec',
        GAS_MAIL_SECRET: 'test-secret',
        NOTIFY_CC_EMAIL: 'biz@fixbox.jp',
      },
      bookingWithEmail,
      lineClient,
      null,
    );

    expect(result.channel).toBe('email');
    expect(result.delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.cc).toEqual(['biz@fixbox.jp']);
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
  // Shared steps mock — booking-reminders are now DB-driven (migration 029).
  // Using fixed step ids matching the seeded production templates so flag-key
  // assertions stay aligned with the real metadata shape.
  const STEP_24H = {
    id: 'sys_booking_step_24h',
    reminder_id: 'sys_booking_reminder_v1',
    offset_minutes: 1440,
    message_type: 'flex',
    message_content: '{"kind":"booking_flex_v1","heading":"面談リマインド｜明日","noteText":"日程変更は下のボタン、その他のご相談はこのトークへ。","primaryButton":{"label":"Google Meetを開く","uri":"{{meet_url}}"},"secondaryButton":{"label":"日程を変更する","uri":"{{reschedule_url}}"}}',
  };
  const STEP_1H = {
    id: 'sys_booking_step_1h',
    reminder_id: 'sys_booking_reminder_v1',
    offset_minutes: 60,
    message_type: 'flex',
    message_content: '{"kind":"booking_flex_v1","heading":"面談リマインド｜1時間前","noteText":"日程変更は下のボタン、その他のご相談はこのトークへ。","primaryButton":{"label":"Google Meetを開く","uri":"{{meet_url}}"},"secondaryButton":{"label":"日程を変更する","uri":"{{reschedule_url}}"}}',
  };
  const allSteps = [STEP_24H, STEP_1H];
  const stepsMock = () => vi.fn().mockResolvedValue(allSteps);

  it('sends 24h reminder and marks metadata.reminder_step_<id>_sent', async () => {
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
        getBookingReminderSteps: stepsMock(),
      } as any,
    );

    expect(summary.delivered).toBe(1);
    expect(pushMessage).toHaveBeenCalledOnce();
    expect(updateBookingMetadata).toHaveBeenCalledWith(
      expect.anything(),
      'b24',
      expect.objectContaining({ reminder_step_sys_booking_step_24h_sent: true }),
    );
    // Regression guard: window bounds must be JST (+09:00) to match stored column format.
    // Passing Z-suffixed UTC strings would silently filter out all rows.
    const opts = getBookingsForReminder.mock.calls[0][1];
    expect(opts.startFrom).toMatch(/\+09:00$/);
    expect(opts.startTo).toMatch(/\+09:00$/);
    // Body regression: LINE reminder is now Flex with Meet URL button
    const [, messages] = pushMessage.mock.calls[0];
    expect(messages[0].type).toBe('flex');
    expect(messages[0].altText).toContain('【明日】');
    expect(messages[0].altText).toContain('10:00');
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
        getBookingReminderSteps: stepsMock(),
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
        {
          GAS_MAIL_URL: 'https://script.google.com/macros/s/TEST/exec',
          GAS_MAIL_SECRET: 'test-secret',
          NOTIFY_CC_EMAIL: 'biz@fixbox.jp',
        },
        {
          now,
          db: {} as any,
          lineClient: { pushMessage } as any,
          getBookingsForReminder: vi.fn().mockResolvedValue([booking]),
          updateBookingMetadata,
          getFriendById: vi.fn().mockResolvedValue(null),
          getBookingReminderSteps: stepsMock(),
        } as any,
      );

      expect(summary.delivered).toBe(1);
      expect(pushMessage).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.secret).toBe('test-secret');
      expect(body.to).toEqual(['customer@example.com']);
      expect(body.cc).toEqual(['biz@fixbox.jp']);
      // 1h bucket uses 【まもなく】; 24h bucket uses 【リマインダー】 — this test is 1h
      expect(body.subject).toMatch(/^Fixx｜【まもなく】整備士面談/);
      expect(updateBookingMetadata).toHaveBeenCalledWith(
        expect.anything(),
        'b1h',
        expect.objectContaining({ reminder_step_sys_booking_step_1h_sent: true, email: 'customer@example.com' }),
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
        getBookingReminderSteps: stepsMock(),
      } as any,
    );
    expect(summary.failed).toBe(1);
    expect(summary.delivered).toBe(0);
    expect(updateBookingMetadata).not.toHaveBeenCalled();
  });
});
