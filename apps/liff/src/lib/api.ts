import { getIdToken, getLiffId } from './liff-auth.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';

export interface MenuItem {
  id: string;
  name: string;
  category_label: string | null;
  description: string | null;
  duration_minutes: number;
  buffer_after_minutes: number;
  base_price: number;
  sort_order: number;
}

export interface StaffItem {
  id: string;
  display_name: string;
  role: string | null;
  profile_image_url: string | null;
  bio: string | null;
  is_designation_optional: number;
  price: number;
  duration_minutes: number;
}

export interface AvailabilityResponse {
  by_staff: Array<{
    staff_id: string;
    display_name: string;
    slots: Array<{ date: string; start: string; end: string }>;
  }>;
}

export interface BookingHistoryItem {
  id: string;
  starts_at: string;
  status: string;
  customer_note?: string | null;
  menu_name: string;
  staff_name: string;
  profile_image_url: string | null;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${getIdToken()}`, ...extra };
}

async function get<T>(path: string): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  url.searchParams.set('liffId', getLiffId());
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    const err = new Error(`API ${res.status}: ${text}`) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return res.json();
}

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  url.searchParams.set('liffId', getLiffId());
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', ...headers }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    const err = new Error(`API ${res.status}`) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return res.json();
}

// ============================================================
// Event booking types
// ============================================================

export interface EventDetail {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
}

export interface EventSlot {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  active_count: number;
  remaining: number | null;
}

export interface EventBookingMine {
  id: string;
  event_id: string;
  status: string;
  customer_note: string | null;
  event_name: string;
  event_image_url: string | null;
  venue_name: string | null;
  venue_url: string | null;
  cancel_deadline_hours_before: number | null;
  slot_starts_at: string;
  slot_ends_at: string;
}

// ===== Webinar =====

export interface WebinarCta {
  label: string;
  url: string;
  showAtSeconds: number;
}

export interface WebinarSakuraComment {
  atSeconds: number;
  authorName: string;
  body: string;
}

export type WebinarState =
  | {
      live: true;
      title: string;
      durationSeconds: number;
      sessionStartAt: number;
      offsetSeconds: number;
      playlistUrl: string;
      cta: WebinarCta | null;
      comments: WebinarSakuraComment[];
    }
  | { live: false; title: string; nextSessionAt: number | null };

export const api = {
  menus: () => get<{ menus: MenuItem[] }>('/api/liff/booking/menus'),
  staffOf: (menuId: string) =>
    get<{ staff: StaffItem[] }>(`/api/liff/booking/menus/${menuId}/staff`),
  availability: (menuId: string, staffId: string | undefined, from: string, to: string) => {
    const qs = new URLSearchParams({ menu_id: menuId, from, to });
    if (staffId) qs.set('staff_id', staffId);
    return get<AvailabilityResponse>(`/api/liff/booking/availability?${qs}`);
  },
  // Worker 側で id_token を verify するので lineUserId は body に入れない。
  createRequest: (
    body: { menu_id: string; staff_id: string; starts_at: string; customer_note?: string },
    idempotencyKey: string,
  ) =>
    post<{ booking_id: string; status: string }>(
      '/api/liff/booking/requests',
      body,
      { 'Idempotency-Key': idempotencyKey },
    ),
  me: () => get<{ upcoming: BookingHistoryItem[]; past: BookingHistoryItem[] }>('/api/liff/booking/me'),

  // ===== Event booking =====
  getEvent: (id: string) => get<EventDetail>(`/api/liff/events/${id}`),
  getEventSlots: (id: string) => get<{ items: EventSlot[] }>(`/api/liff/events/${id}/slots`),
  createEventBooking: (
    eventId: string,
    body: { slot_id: string; customer_note?: string | null },
    idempotencyKey: string,
  ) =>
    post<{ id: string; status: string }>(
      `/api/liff/events/${eventId}/bookings`,
      body,
      { 'Idempotency-Key': idempotencyKey },
    ),
  myEventBookings: (tab: 'upcoming' | 'past') =>
    get<{ items: EventBookingMine[] }>(`/api/liff/events/me?tab=${tab}`),
  cancelMyEventBooking: (bookingId: string) =>
    post<{ ok: true }>(`/api/liff/events/me/${bookingId}/cancel`, {}),

  // ===== Webinar =====
  webinarState: (slug: string) => get<WebinarState>(`/api/liff/webinars/${slug}`),
  webinarHeartbeat: (slug: string, sessionStartAt: number, positionSeconds: number) =>
    post<{ ok: true }>(`/api/liff/webinars/${slug}/heartbeat`, { sessionStartAt, positionSeconds }),
  webinarComment: (slug: string, sessionStartAt: number, atSeconds: number, body: string) =>
    post<{ ok: true }>(`/api/liff/webinars/${slug}/comments`, { sessionStartAt, atSeconds, body }),
  webinarCtaClick: (slug: string, sessionStartAt: number) =>
    post<{ ok: true }>(`/api/liff/webinars/${slug}/cta-click`, { sessionStartAt }),
};
