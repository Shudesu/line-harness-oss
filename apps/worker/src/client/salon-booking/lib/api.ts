// Salon booking API client. Uses caller context provided by main.ts.

import type { SalonBookingContext } from './context.js';

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
    has_working_hours?: boolean;
  }>;
  calendar_sync?: Array<{
    staff_id: string;
    configured: boolean;
    ok: boolean;
    error?: 'unavailable';
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

function authHeaders(ctx: SalonBookingContext, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${ctx.idToken}`, ...extra };
}

function withLiff(path: string, ctx: SalonBookingContext): string {
  const u = new URL(path, window.location.origin);
  u.searchParams.set('liffId', ctx.liffId);
  return u.pathname + u.search;
}

async function get<T>(path: string, ctx: SalonBookingContext): Promise<T> {
  const res = await fetch(withLiff(path, ctx), { headers: authHeaders(ctx) });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(
  path: string,
  body: unknown,
  ctx: SalonBookingContext,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(withLiff(path, ctx), {
    method: 'POST',
    headers: authHeaders(ctx, { 'Content-Type': 'application/json', ...headers }),
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

export function createApi(ctx: SalonBookingContext) {
  return {
    menus: () => get<{ menus: MenuItem[] }>('/api/liff/booking/menus', ctx),
    staffOf: (menuId: string) =>
      get<{ staff: StaffItem[] }>(`/api/liff/booking/menus/${menuId}/staff`, ctx),
    availability: (
      menuId: string,
      staffId: string | undefined,
      from: string,
      to: string,
    ) => {
      const qs = new URLSearchParams({ menu_id: menuId, from, to });
      if (staffId) qs.set('staff_id', staffId);
      return get<AvailabilityResponse>(`/api/liff/booking/availability?${qs}`, ctx);
    },
    createRequest: (
      body: { menu_id: string; staff_id: string; starts_at: string; customer_note?: string },
      idempotencyKey: string,
    ) =>
      post<{ booking_id: string; status: string }>(
        '/api/liff/booking/requests',
        body,
        ctx,
        { 'Idempotency-Key': idempotencyKey },
      ),
    me: () =>
      get<{ upcoming: BookingHistoryItem[]; past: BookingHistoryItem[] }>(
        '/api/liff/booking/me',
        ctx,
      ),
  };
}
