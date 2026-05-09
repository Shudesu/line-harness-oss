import type { Menu, Reservation, ReservationAccessTokens, Resource, Slot } from './types.js';

export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const json = await res.json().catch(() => null) as { success?: boolean; data?: T; error?: string; code?: string } | null;
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || json?.code || `API request failed: ${res.status}`);
  }
  return json.data as T;
}

export function createReservationSession(input: { idToken: string; displayName: string; liffId?: string | null }) {
  return apiJson<{ token: string; friendId: string; userId: string; expiresIn?: number }>('/api/public/reservation-session', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listResources() {
  return apiJson<Resource[]>('/api/public/reservation-resources');
}

export function listMenus(resourceId: string) {
  return apiJson<Menu[]>(`/api/public/reservation-resources/${encodeURIComponent(resourceId)}/menus`);
}

export function listSlots(input: {
  resourceId: string;
  menuId: string;
  date: string;
  people: number;
  adultCount?: number;
  childCount?: number;
  infantCount?: number;
}) {
  const query = new URLSearchParams({
    date: input.date,
    menuId: input.menuId,
    people: String(Math.max(1, input.people)),
  });
  if (input.adultCount !== undefined) query.set('adultCount', String(Math.max(0, input.adultCount)));
  if (input.childCount !== undefined) query.set('childCount', String(Math.max(0, input.childCount)));
  if (input.infantCount !== undefined) query.set('infantCount', String(Math.max(0, input.infantCount)));
  return apiJson<Slot[]>(`/api/public/reservation-resources/${encodeURIComponent(input.resourceId)}/slots?${query}`);
}

export function createReservation(input: {
  token: string;
  resourceId: string;
  menuId: string;
  slotId: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  customer: { name: string; phone: string; email: string | null };
  formData: { note: string | null };
}) {
  return apiJson<Reservation>('/api/public/reservations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({
      resourceId: input.resourceId,
      menuId: input.menuId,
      slotId: input.slotId,
      adultCount: input.adultCount,
      childCount: input.childCount,
      infantCount: input.infantCount,
      customer: input.customer,
      formData: input.formData,
    }),
  });
}

export function listMyReservations(token: string) {
  return apiJson<Reservation[]>('/api/public/me/reservations?status=active', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function issueReservationTokens(input: { reservationId: string; token: string }) {
  return apiJson<ReservationAccessTokens>(`/api/public/reservations/${encodeURIComponent(input.reservationId)}/tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({}),
  });
}

export function cancelReservation(input: { reservationId: string; cancelToken: string; reason?: string }) {
  return apiJson<{ reservation: Reservation; changed: boolean }>(
    `/api/public/reservations/${encodeURIComponent(input.reservationId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({
        token: input.cancelToken,
        reason: input.reason ?? 'customer_requested',
      }),
    },
  );
}
