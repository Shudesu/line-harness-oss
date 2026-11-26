import { describe, expect, test, vi } from 'vitest';

// adminCalendarReturnUrl doesn't touch these services itself, but booking.ts
// (the module it lives in) imports them at module scope — same minimal mock
// set booking-admin.test.ts already established for importing this file.
const availabilityMocks = {
  computeSlots: vi.fn(() => [] as { start: string; end: string }[]),
  getAvailability: vi.fn(async () => ({ by_staff: [] })),
};
vi.mock('../services/availability.js', () => availabilityMocks);

const notifierMocks = { sendBookingNotification: vi.fn() };
vi.mock('../services/booking-notifier.js', () => notifierMocks);

const { adminCalendarReturnUrl } = await import('./booking.js');

function env(over: Partial<{ ADMIN_PUBLIC_URL: string }> = {}) {
  return { ADMIN_PUBLIC_URL: undefined, ...over } as unknown as Parameters<
    typeof adminCalendarReturnUrl
  >[0];
}

// codex review round 2 (2026-08-24): `new URL('/booking/staff/shifts', base)`
// REPLACES base's own pathname (WHATWG URL semantics for a path-absolute
// second argument) — the naive implementation silently dropped
// ADMIN_PUBLIC_URL's basePath (e.g. /console, three-surfaces bundle), so a
// single-origin install's Google Calendar "connect" flow bounced back to the tenant
// root (the LIFF app) instead of the admin settings page it started from.
describe('adminCalendarReturnUrl', () => {
  test('preserves ADMIN_PUBLIC_URL basePath (three-surfaces layout, no adminOrigin captured)', () => {
    const url = adminCalendarReturnUrl(
      env({ ADMIN_PUBLIC_URL: 'https://tenant.example.test/console' }),
      'staff-1',
      'connected',
      undefined,
    );
    expect(url).toBe('https://tenant.example.test/console/booking/staff/shifts?staff_id=staff-1&google=connected');
  });

  test('prefers ADMIN_PUBLIC_URL (with basePath) over a same-origin adminOrigin (Origin headers never carry a path)', () => {
    const url = adminCalendarReturnUrl(
      env({ ADMIN_PUBLIC_URL: 'https://tenant.example.test/console' }),
      null,
      'denied',
      'https://tenant.example.test', // captured Origin header — same origin, no path by construction
    );
    expect(url).toBe('https://tenant.example.test/console/booking/staff/shifts?google=denied');
  });

  test('uses the bare adminOrigin when it differs from ADMIN_PUBLIC_URL (legacy separate-Pages admin)', () => {
    const url = adminCalendarReturnUrl(
      env({ ADMIN_PUBLIC_URL: 'https://tenant.example.test/console' }),
      'staff-2',
      'error',
      'https://admin-legacy.pages.dev',
    );
    expect(url).toBe('https://admin-legacy.pages.dev/booking/staff/shifts?staff_id=staff-2&google=error');
  });

  test('falls back to the hardcoded default when neither adminOrigin nor ADMIN_PUBLIC_URL is set', () => {
    const url = adminCalendarReturnUrl(env(), null, 'connected', undefined);
    expect(url).toBe('https://your-admin.pages.dev/booking/staff/shifts?google=connected');
  });

  test('root ADMIN_PUBLIC_URL (no basePath, self-hosted/legacy default) behaves exactly as before', () => {
    const url = adminCalendarReturnUrl(
      env({ ADMIN_PUBLIC_URL: 'https://tenant.example.test' }),
      'staff-3',
      'connected',
      undefined,
    );
    expect(url).toBe('https://tenant.example.test/booking/staff/shifts?staff_id=staff-3&google=connected');
  });
});
