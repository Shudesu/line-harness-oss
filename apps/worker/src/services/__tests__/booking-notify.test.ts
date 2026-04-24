import { describe, it, expect, vi } from 'vitest';
import { sendBookingConfirmation, pickChannel, formatJstRange } from '../booking-notify.js';

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
