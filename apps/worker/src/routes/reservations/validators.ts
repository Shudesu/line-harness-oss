import type { Reservation, ReservationSource, ReservationStatus } from '@line-crm/db';

export function parseReservationStatus(value?: string): ReservationStatus | undefined {
  const statuses: ReservationStatus[] = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'];
  return statuses.includes(value as ReservationStatus) ? (value as ReservationStatus) : undefined;
}

export function parseReservationSource(value?: string): ReservationSource | undefined {
  const sources: ReservationSource[] = ['line', 'jalan', 'phone', 'gmail', 'admin', 'mcp'];
  return sources.includes(value as ReservationSource) ? (value as ReservationSource) : undefined;
}

export function canAccessReservation(
  payload: { userId?: string | null; friendId?: string | null; reservationId?: string },
  reservation: Reservation,
): boolean {
  if (payload.reservationId && payload.reservationId !== reservation.id) return false;
  if (payload.userId && reservation.user_id === payload.userId) return true;
  if (payload.friendId && reservation.friend_id === payload.friendId) return true;
  return false;
}
