/**
 * Layer 1: Pure logic tests — no D1, no miniflare.
 * Tests getReservationSlotAvailability and nullableText.
 */
import { describe, it, expect } from 'vitest';
import {
  getReservationSlotAvailability,
  nullableText,
  type ReservationSlot,
} from './reservations.js';

// ---------------------------------------------------------------------------
// Helper to build a slot with overrides
// ---------------------------------------------------------------------------
function makeSlot(overrides: Partial<ReservationSlot> = {}): ReservationSlot {
  return {
    id: 'slot1',
    resource_id: 'res_test',
    date: '2026-06-01',
    start_at: '2026-06-01T09:00:00+09:00',
    end_at: '2026-06-01T10:00:00+09:00',
    total_capacity: 10,
    line_capacity: 5,
    external_capacity: 5,
    buffer_capacity: 0,
    reserved_count: 0,
    line_reserved_count: 0,
    external_reserved_count: 0,
    status: 'open',
    note: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

// ===========================================================================
// nullableText
// ===========================================================================
describe('nullableText', () => {
  it('returns null for empty string', () => expect(nullableText('')).toBeNull());
  it('returns null for whitespace only', () => expect(nullableText('   ')).toBeNull());
  it('returns null for undefined', () => expect(nullableText(undefined)).toBeNull());
  it('returns null for null', () => expect(nullableText(null)).toBeNull());
  it('trims and returns non-empty string', () => expect(nullableText(' hello ')).toBe('hello'));
  it('preserves internal whitespace', () => expect(nullableText(' a b ')).toBe('a b'));
});

// ===========================================================================
// getReservationSlotAvailability
// ===========================================================================
describe('getReservationSlotAvailability', () => {
  it('calculates remaining capacity with buffer', () => {
    const slot = makeSlot({
      total_capacity: 10,
      buffer_capacity: 2,
      reserved_count: 3,
      line_reserved_count: 2,
      external_reserved_count: 1,
    });
    const avail = getReservationSlotAvailability(slot, 1);
    // effective = 10 - 2 = 8, remaining = 8 - 3 = 5
    // lineRemaining = min(5, 5 - 2) = 3
    // externalRemaining = min(5, 5 - 1) = 4
    expect(avail.remaining_capacity).toBe(5);
    expect(avail.line_remaining_capacity).toBe(3);
    expect(avail.external_remaining_capacity).toBe(4);
    expect(avail.available).toBe(true);
  });

  it('returns available=false when status is closed', () => {
    const avail = getReservationSlotAvailability(makeSlot({ status: 'closed' }), 1);
    expect(avail.available).toBe(false);
  });

  it('returns available=false when status is sold_out', () => {
    const avail = getReservationSlotAvailability(makeSlot({ status: 'sold_out' }), 1);
    expect(avail.available).toBe(false);
  });

  it('returns available=false when line_remaining < requested people', () => {
    const slot = makeSlot({
      total_capacity: 10,
      line_capacity: 2,
      reserved_count: 1,
      line_reserved_count: 1,
    });
    // lineRemaining = min(9, 2-1) = 1, requested = 3
    expect(getReservationSlotAvailability(slot, 3).available).toBe(false);
  });

  it('returns available=false when total remaining < requested people', () => {
    const slot = makeSlot({
      total_capacity: 3,
      line_capacity: null, // no per-channel limit
      reserved_count: 2,
    });
    // remaining = 3 - 2 = 1, requested = 2
    expect(getReservationSlotAvailability(slot, 2).available).toBe(false);
  });

  it('uses total_capacity - buffer as line limit when line_capacity is null', () => {
    const slot = makeSlot({
      total_capacity: 10,
      line_capacity: null,
      buffer_capacity: 2,
      reserved_count: 3,
      line_reserved_count: 3,
    });
    // effective = 8, remaining = 5, lineLimit = 8, lineRemaining = min(5, 8-3) = 5
    const avail = getReservationSlotAvailability(slot, 1);
    expect(avail.line_remaining_capacity).toBe(5);
    expect(avail.available).toBe(true);
  });

  it('clamps negative values to 0', () => {
    const slot = makeSlot({
      total_capacity: 2,
      buffer_capacity: 5, // buffer > total
      reserved_count: 0,
    });
    const avail = getReservationSlotAvailability(slot, 1);
    expect(avail.remaining_capacity).toBe(0);
    expect(avail.available).toBe(false);
  });

  it('returns available=true when exactly enough capacity', () => {
    const slot = makeSlot({
      total_capacity: 3,
      line_capacity: 3,
      reserved_count: 0,
      line_reserved_count: 0,
    });
    expect(getReservationSlotAvailability(slot, 3).available).toBe(true);
  });
});
