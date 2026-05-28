import type { Reservation, StoredTokens } from './types.js';

const TOKEN_STORAGE_KEY = 'lh_reservation_tokens';

function storedTokens(): Record<string, StoredTokens> {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}') as Record<string, StoredTokens>;
  } catch {
    return {};
  }
}

export function storeReservationTokens(reservation: Reservation): void {
  if (!reservation.detailToken && !reservation.cancelToken) return;
  try {
    const tokens = storedTokens();
    tokens[reservation.id] = {
      detailToken: reservation.detailToken,
      cancelToken: reservation.cancelToken,
    };
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // The list still works; only stored cancellation tokens are unavailable.
  }
}

export function storeTokensForReservation(reservationId: string, tokens: StoredTokens): void {
  try {
    const allTokens = storedTokens();
    allTokens[reservationId] = {
      ...allTokens[reservationId],
      ...tokens,
    };
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(allTokens));
  } catch {
    // Optional enhancement only.
  }
}

export function tokenForReservation(id: string): StoredTokens {
  return storedTokens()[id] ?? {};
}
