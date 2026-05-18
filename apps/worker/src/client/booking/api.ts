import type { AvailabilitySummary, Menu, Reservation, ReservationAccessTokens, Resource, Slot } from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
    if (res.status !== 429) break;
    const retryAfter = Number.parseInt(res.headers.get('Retry-After') ?? '', 10);
    await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * (attempt + 1));
  }
  if (!res) throw new Error('API request failed');
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
  underThreeCount?: number;
}) {
  const query = new URLSearchParams({
    date: input.date,
    menuId: input.menuId,
    people: String(Math.max(1, input.people)),
  });
  if (input.adultCount !== undefined) query.set('adultCount', String(Math.max(0, input.adultCount)));
  if (input.childCount !== undefined) query.set('childCount', String(Math.max(0, input.childCount)));
  if (input.infantCount !== undefined) query.set('infantCount', String(Math.max(0, input.infantCount)));
  if (input.underThreeCount !== undefined) query.set('underThreeCount', String(Math.max(0, input.underThreeCount)));
  return apiJson<Slot[]>(`/api/public/reservation-resources/${encodeURIComponent(input.resourceId)}/slots?${query}`);
}

export function listAvailabilitySummary(input: {
  resourceId: string;
  menuId: string;
  dateFrom: string;
  dateTo: string;
  people: number;
  adultCount?: number;
  childCount?: number;
  infantCount?: number;
  underThreeCount?: number;
}) {
  const query = new URLSearchParams({
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    menuId: input.menuId,
    people: String(Math.max(1, input.people)),
  });
  if (input.adultCount !== undefined) query.set('adultCount', String(Math.max(0, input.adultCount)));
  if (input.childCount !== undefined) query.set('childCount', String(Math.max(0, input.childCount)));
  if (input.infantCount !== undefined) query.set('infantCount', String(Math.max(0, input.infantCount)));
  if (input.underThreeCount !== undefined) query.set('underThreeCount', String(Math.max(0, input.underThreeCount)));
  return apiJson<AvailabilitySummary[]>(
    `/api/public/reservation-resources/${encodeURIComponent(input.resourceId)}/availability-summary?${query}`,
  );
}

export function createReservation(input: {
  token: string;
  resourceId: string;
  menuId: string;
  slotId: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  underThreeCount: number;
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
      underThreeCount: input.underThreeCount,
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

export function recordLiffEvent(input: {
  token: string;
  eventType: string;
  eventName?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return apiJson<{ id: string }>('/api/public/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({
      eventType: input.eventType,
      eventName: input.eventName ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: input.metadata ?? {},
    }),
  });
}
