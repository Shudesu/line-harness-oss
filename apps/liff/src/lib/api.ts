import { getIdToken, getLiffId } from './liff-auth.js';

const BASE = import.meta.env.VITE_API_BASE ?? '';
const DEV_MOCK = import.meta.env.DEV && new URL(window.location.href).searchParams.get('__mock') === '1';

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
  const mocked = maybeMockGet<T>(path);
  if (mocked) return mocked;
  const url = new URL(`${BASE}${path}`, window.location.origin);
  url.searchParams.set('liffId', getLiffId());
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const mocked = maybeMockPost<T>(path);
  if (mocked) return mocked;
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

export interface EventListItem extends EventDetail {
  next_slot_starts_at: string;
  next_slot_ends_at: string;
  future_slot_count: number;
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

const mockEvents: EventListItem[] = [
  {
    id: 'kazama',
    name: '風間佑太プロダーツ交流会',
    venue_name: '茶はいダーツバー西新宿Luu',
    venue_url: null,
    image_url: null,
    description: 'プロと一緒にダーツ交流を楽しめるイベントです。',
    description_centered: 0,
    max_bookings_per_friend: null,
    requires_approval: 0,
    cancel_deadline_hours_before: null,
    next_slot_starts_at: '2026-06-22T10:00:00.000Z',
    next_slot_ends_at: '2026-06-22T14:00:00.000Z',
    future_slot_count: 1,
  },
  {
    id: 'kumagai-morota',
    name: '熊谷幸花プロ＆母良田桃香プロ交流会',
    venue_name: '茶はいダーツバー西新宿Luu',
    venue_url: null,
    image_url: null,
    description: '人数と同行者名を入力して予約できます。',
    description_centered: 0,
    max_bookings_per_friend: null,
    requires_approval: 0,
    cancel_deadline_hours_before: null,
    next_slot_starts_at: '2026-06-29T09:00:00.000Z',
    next_slot_ends_at: '2026-06-29T13:00:00.000Z',
    future_slot_count: 1,
  },
];

const mockSlots: EventSlot[] = [
  {
    id: 'slot-1',
    event_id: 'kazama',
    starts_at: '2026-06-22T10:00:00.000Z',
    ends_at: '2026-06-22T14:00:00.000Z',
    capacity: 20,
    is_active: 1,
    active_count: 4,
    remaining: 16,
  },
];

function maybeMockGet<T>(path: string): T | null {
  if (!DEV_MOCK) return null;
  const [pathname] = path.split('?');
  if (pathname === '/api/liff/events') return { items: mockEvents } as T;
  if (pathname === '/api/liff/events/kazama') return mockEvents[0] as T;
  if (pathname === '/api/liff/events/kazama/slots') return { items: mockSlots } as T;
  if (pathname === '/api/liff/events/me') return { items: [] } as T;
  return null;
}

function maybeMockPost<T>(path: string): T | null {
  if (!DEV_MOCK) return null;
  if (path === '/api/liff/events/kazama/bookings') {
    return { id: 'mock-booking', status: 'confirmed' } as T;
  }
  return null;
}

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
  listEvents: () => get<{ items: EventListItem[] }>('/api/liff/events'),
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
};
