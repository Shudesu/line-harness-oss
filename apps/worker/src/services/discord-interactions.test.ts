import { describe, expect, it } from 'vitest';
import type { Reservation } from '@line-crm/db';
import {
  buildDiscordReservationCompleteId,
  buildReservationListMessage,
  normalizeDiscordReservationDate,
  parseDiscordReservationCompleteId,
} from './discord-interactions.js';

describe('discord reservation interactions', () => {
  it('normalizes YYYYMMDD and YYYY-MM-DD dates', () => {
    expect(normalizeDiscordReservationDate('20260612')).toBe('2026-06-12');
    expect(normalizeDiscordReservationDate('2026-06-12')).toBe('2026-06-12');
    expect(normalizeDiscordReservationDate('20260230')).toBeNull();
    expect(normalizeDiscordReservationDate('2026/06/12')).toBeNull();
  });

  it('builds reservation list with complete buttons only for active reservations', () => {
    const confirmed = reservation({ id: 'r_confirmed', status: 'confirmed', customer_name_snapshot: '山田 太郎' });
    const pending = reservation({ id: 'r_pending', status: 'pending', customer_name_snapshot: '佐藤 花子' });
    const cancelled = reservation({ id: 'r_cancelled', status: 'cancelled', customer_name_snapshot: 'キャンセル済み' });

    const message = buildReservationListMessage('2026-06-12', [confirmed, pending, cancelled]);

    expect(message.content).toContain('2件');
    expect(message.embeds?.[0]?.fields).toHaveLength(2);
    expect(message.components?.[0]?.components).toHaveLength(2);
    expect(message.components?.[0]?.components[0]).toMatchObject({
      style: 3,
      custom_id: 'reservation:complete:r_confirmed',
      disabled: false,
    });
    expect(message.components?.[0]?.components[1]).toMatchObject({
      custom_id: 'reservation:complete:r_pending',
      disabled: true,
    });
  });

  it('round-trips complete custom ids and rejects unknown ids', () => {
    const customId = buildDiscordReservationCompleteId('reservation-1');
    expect(parseDiscordReservationCompleteId(customId)).toBe('reservation-1');
    expect(parseDiscordReservationCompleteId('unknown:reservation-1')).toBeNull();
    expect(parseDiscordReservationCompleteId(undefined)).toBeNull();
  });
});

function reservation(overrides: Partial<Reservation>): Reservation {
  return {
    id: 'r1',
    line_account_id: null,
    user_id: null,
    friend_id: null,
    slot_id: 'slot1',
    source: 'line',
    capacity_channel: 'line',
    external_reservation_id: null,
    dedupe_key: null,
    title: '予約',
    reservation_date: '2026-06-12',
    start_at: '2026-06-12T09:00:00+09:00',
    end_at: '2026-06-12T10:00:00+09:00',
    status: 'confirmed',
    adult_count: 2,
    child_count: 0,
    infant_count: 0,
    under_three_count: 0,
    total_people: 2,
    capacity_people: 2,
    customer_name_snapshot: '山田 太郎',
    customer_phone_snapshot: null,
    customer_email_snapshot: null,
    cancel_reason: null,
    form_data: '{}',
    metadata: '{}',
    total_amount: null,
    created_at: '2026-06-01T00:00:00+09:00',
    updated_at: '2026-06-01T00:00:00+09:00',
    ...overrides,
  };
}
