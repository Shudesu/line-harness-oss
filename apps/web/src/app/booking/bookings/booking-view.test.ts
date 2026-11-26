import { describe, expect, it } from 'vitest'
import type { BookingRequest } from '@/lib/api'
import {
  getBookingTimeGroup,
  isRecentlyReceived,
  matchesTimeFilter,
  sortBookings,
} from './booking-view'

const now = new Date('2026-08-15T06:00:00.000Z') // JST 15:00

function booking(id: string, startsAt: string, requestedAt: string): BookingRequest {
  return {
    id,
    friend_id: `friend-${id}`,
    starts_at: startsAt,
    ends_at: startsAt,
    status: 'confirmed',
    customer_note: null,
    internal_note: null,
    price_at_booking: 0,
    menu_name: '相談',
    staff_name: '担当者',
    friend_name: '顧客',
    requested_at: requestedAt,
  }
}

describe('booking view helpers', () => {
  it('JST の日付で今日・今後・過去を分類する', () => {
    expect(getBookingTimeGroup('2026-08-14T15:30:00.000Z', now)).toBe('today')
    expect(getBookingTimeGroup('2026-08-15T15:00:00.000Z', now)).toBe('future')
    expect(getBookingTimeGroup('2026-08-14T14:59:59.000Z', now)).toBe('past')
  })

  it('今日以降フィルターは今日と未来だけを含む', () => {
    expect(matchesTimeFilter('2026-08-14T15:00:00.000Z', 'upcoming', now)).toBe(true)
    expect(matchesTimeFilter('2026-08-16T00:00:00.000Z', 'upcoming', now)).toBe(true)
    expect(matchesTimeFilter('2026-08-14T14:59:59.000Z', 'upcoming', now)).toBe(false)
  })

  it('予定順では今後を昇順、過去を降順に並べる', () => {
    const older = booking('older', '2026-08-16T01:00:00.000Z', '2026-08-10T00:00:00.000Z')
    const newer = booking('newer', '2026-08-17T01:00:00.000Z', '2026-08-14T00:00:00.000Z')
    expect(sortBookings([newer, older], 'schedule', 'future').map((b) => b.id)).toEqual(['older', 'newer'])
    expect(sortBookings([older, newer], 'schedule', 'past').map((b) => b.id)).toEqual(['newer', 'older'])
    expect(sortBookings([older, newer], 'received', 'future').map((b) => b.id)).toEqual(['newer', 'older'])
  })

  it('72時間以内の受付を新着と判定する', () => {
    expect(isRecentlyReceived('2026-08-13T06:00:00.000Z', now)).toBe(true)
    expect(isRecentlyReceived('2026-08-11T06:00:00.000Z', now)).toBe(false)
  })
})
