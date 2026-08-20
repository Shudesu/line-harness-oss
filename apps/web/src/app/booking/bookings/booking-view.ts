import type { BookingRequest } from '@/lib/api'

export type BookingTimeFilter = 'upcoming' | 'today' | 'future' | 'past' | 'all'
export type BookingSort = 'schedule' | 'received'
export type BookingTimeGroup = 'today' | 'future' | 'past'

const JST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tokyo',
})

function jstDateKey(value: string | Date): string {
  const parts = JST_DATE_FORMATTER.formatToParts(
    typeof value === 'string' ? new Date(value) : value,
  )
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${year}-${month}-${day}`
}

export function getBookingTimeGroup(
  startsAt: string,
  now: Date = new Date(),
): BookingTimeGroup {
  const bookingDate = jstDateKey(startsAt)
  const today = jstDateKey(now)
  if (bookingDate === today) return 'today'
  return bookingDate > today ? 'future' : 'past'
}

export function matchesTimeFilter(
  startsAt: string,
  filter: BookingTimeFilter,
  now: Date = new Date(),
): boolean {
  if (filter === 'all') return true
  const group = getBookingTimeGroup(startsAt, now)
  if (filter === 'upcoming') return group === 'today' || group === 'future'
  return group === filter
}

export function sortBookings(
  bookings: BookingRequest[],
  sort: BookingSort,
  group: BookingTimeGroup,
): BookingRequest[] {
  return [...bookings].sort((a, b) => {
    if (sort === 'received') {
      return new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime()
    }

    const direction = group === 'past' ? -1 : 1
    return direction * (new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
  })
}

export function isRecentlyReceived(
  requestedAt: string,
  now: Date = new Date(),
  withinHours = 72,
): boolean {
  const elapsed = now.getTime() - new Date(requestedAt).getTime()
  return elapsed >= 0 && elapsed <= withinHours * 60 * 60 * 1000
}
