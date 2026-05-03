import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ReservationApiErrorCode, ReservationApiResponse } from '@line-crm/shared';

const errorMessages: Record<ReservationApiErrorCode, string> = {
  bad_request: 'Bad request',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  not_found: 'Not found',
  slot_not_available: 'Slot is not available',
  invalid_slot: 'Invalid slot',
  invalid_people: 'Invalid people count',
  invalid_state_transition: 'Invalid state transition',
  missing_dedupe_key: 'externalId or dedupeKey is required',
  internal_error: 'Internal server error',
};

export function reservationSuccess<T>(data: T): ReservationApiResponse<T> {
  return { success: true, data };
}

export function reservationError(
  code: ReservationApiErrorCode,
  message = errorMessages[code],
  details?: Record<string, string[]>,
): ReservationApiResponse<never> {
  return details ? { success: false, error: message, code, details } : { success: false, error: message, code };
}

export function jsonOk<T>(c: Context, data: T, status?: ContentfulStatusCode) {
  return status ? c.json(reservationSuccess(data), status) : c.json(reservationSuccess(data));
}

export function jsonError(
  c: Context,
  code: ReservationApiErrorCode,
  status: ContentfulStatusCode,
  message?: string,
  details?: Record<string, string[]>,
) {
  return c.json(reservationError(code, message, details), status);
}

export function statusForCreateReservationFailure(reason: string): ContentfulStatusCode {
  return reason === 'slot_not_available' ? 409 : 400;
}

export function codeForCreateReservationFailure(reason: string): ReservationApiErrorCode {
  if (reason === 'slot_not_available') return 'slot_not_available';
  if (reason === 'invalid_slot') return 'invalid_slot';
  if (reason === 'invalid_people') return 'invalid_people';
  if (reason === 'not_found') return 'not_found';
  return 'bad_request';
}
