import { afterEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import booking from './booking.js';
import { verifyGoogleOAuthState } from '../services/google-oauth.js';
import { verifyStaffCalendarConnection } from '../services/booking-calendar-sync.js';

const ORIGIN = 'https://aaaaaaaaaaaa.lharness.cloud';
const PATH = '/api/booking/admin/staff/staff-1/google-calendar';
const CALLBACK = '/api/booking/google-calendar/oauth/callback';
const credentials = { calendarBrokerUrl: 'https://cloud.example', calendarBrokerSecret: 'tenant-secret', calendarTenantId: 'aaaaaaaaaaaa' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(connection: Record<string, unknown> | null = null) {
  let state = '';
  const writes: { sql: string; params: unknown[] }[] = [];
  const db = { prepare: (sql: string) => ({ bind: (...params: unknown[]) => ({
    first: async () => sql.includes('FROM staff WHERE') ? { ok: 1 } : sql.includes('SELECT auth_type') ? connection : null,
    run: async () => { writes.push({ sql, params }); return { meta: { changes: 1 } }; },
  }) }) };
  const env = { DB: db, API_KEY: 'tenant-api-key', ADMIN_PUBLIC_URL: ORIGIN + '/console',
    GOOGLE_CALENDAR_BROKER_URL: credentials.calendarBrokerUrl,
    GOOGLE_CALENDAR_BROKER_SECRET: credentials.calendarBrokerSecret,
    GOOGLE_CALENDAR_TENANT_ID: credentials.calendarTenantId };
  const app = new Hono().route('/', booking);
  const mocked = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/tenant/status')) return json({ configured: true });
    if (url.endsWith('/tenant/start')) {
      state = JSON.parse(init?.body as string).state;
      return json({ authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque' });
    }
    if (url.endsWith('/tenant/token')) return json({ accessToken: 'short-access', refreshToken: 'lhc1.encrypted', state, expiresIn: 3600 });
    if (url.includes('/events?')) return json({ items: [] });
    if (url.endsWith('/freeBusy')) return json({ calendars: { primary: { busy: [] } } });
    throw new Error('unexpected fetch');
  });
  vi.stubGlobal('fetch', mocked);
  const start = async () => {
    const result = await app.request(ORIGIN + PATH + '/oauth/start?account_id=account-1', { method: 'POST', headers: { Origin: ORIGIN } }, env);
    expect(result.status).toBe(200);
    const cookie = result.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Lax');
    const payload = await verifyGoogleOAuthState(state, env.API_KEY);
    expect(payload).toMatchObject({ broker: true, accountId: 'account-1', staffId: 'staff-1' });
    return { state, cookie: cookie.split(';')[0] };
  };
  return { env, app, start, mocked, writes };
}

describe('managed Calendar connection', () => {
  test('reports unavailable Cloud configuration and keeps secrets out of the API response', async () => {
    const { env, app, mocked } = setup();
    mocked.mockResolvedValue(json({ error: 'not_ready' }, 503));
    const result = await app.request(ORIGIN + PATH + '?account_id=account-1', {}, env);
    const body = await result.json() as { oauth: unknown };
    expect(body.oauth).toEqual({ configured: false, managed: true });
    expect(JSON.stringify(body)).not.toContain('tenant-secret');
    const start = await app.request(ORIGIN + PATH + '/oauth/start?account_id=account-1', { method: 'POST' }, env);
    expect(start.status).toBe(503);
  });
  test('completes with browser binding and returns to the console subpath', async () => {
    const { env, app, start, writes, mocked } = setup();
    const flow = await start();
    const result = await app.request(ORIGIN + CALLBACK + '?broker_ticket=ticket&state=' + encodeURIComponent(flow.state), { headers: { Cookie: flow.cookie } }, env);
    expect(result.headers.get('Location')).toBe(ORIGIN + '/console/booking/staff/shifts?staff_id=staff-1&google=connected');
    expect(writes).toHaveLength(1);
    expect(writes[0].params).toContain('lhc1.encrypted');
    expect(writes[0].params).toContain('account-1');
    expect(writes[0].params).toContain('staff-1');
    const call = mocked.mock.calls.find(([url]) => String(url).endsWith('/tenant/token'))!;
    expect(call[1]?.headers).toMatchObject({ Authorization: 'Bearer tenant-secret', 'X-Calendar-Tenant': 'aaaaaaaaaaaa' });
  });
  test('rejects callbacks initiated by another browser without redeeming the ticket', async () => {
    const { env, app, start, writes, mocked } = setup();
    const flow = await start();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await app.request(ORIGIN + CALLBACK + '?broker_ticket=ticket&state=' + encodeURIComponent(flow.state), {}, env);
    expect(result.headers.get('Location')).toContain('google=error');
    expect(writes).toHaveLength(0);
    expect(mocked.mock.calls.some(([url]) => String(url).endsWith('/tenant/token'))).toBe(false);
  });
  test('rejects a ticket for a different signed state before saving credentials', async () => {
    const { env, app, start, writes, mocked } = setup();
    const flow = await start();
    mocked.mockResolvedValue(json({ accessToken: 'access', refreshToken: 'lhc1.encrypted', state: 'other-state' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await app.request(ORIGIN + CALLBACK + '?broker_ticket=ticket&state=' + encodeURIComponent(flow.state), { headers: { Cookie: flow.cookie } }, env);
    expect(result.headers.get('Location')).toContain('google=error');
    expect(writes).toHaveLength(0);
  });
  test('refreshes broker connections before checking busy times; direct OAuth still refreshes directly', async () => {
    const mocked = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).includes('/events?') ? json({ items: [] }) : String(url).endsWith('/freeBusy')
      ? json({ calendars: { primary: { busy: [] } } })
      : String(url).endsWith('/tenant/token') ? json({ accessToken: 'new-broker-access' }) : json({ access_token: 'new-direct-access' }));
    vi.stubGlobal('fetch', mocked);
    const connection = { id: 'connection', calendar_id: 'primary', auth_type: 'oauth', access_token: 'expired', refresh_token: 'lhc1.encrypted' };
    await verifyStaffCalendarConnection(connection, credentials);
    expect(String(mocked.mock.calls[0][0])).toBe('https://cloud.example/calendar/oauth/tenant/token');
    expect(mocked.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer new-broker-access' });
    await verifyStaffCalendarConnection({ ...connection, refresh_token: 'direct-refresh' }, { ...credentials, oauthClientId: 'direct-id', oauthClientSecret: 'direct-secret' });
    expect(mocked.mock.calls.some(([url]) => String(url) === 'https://oauth2.googleapis.com/token')).toBe(true);
  });
  test('revoke failure preserves the stored credential for retry; success clears it', async () => {
    const { env, app, writes, mocked } = setup({ auth_type: 'oauth', refresh_token: 'lhc1.encrypted' });
    mocked.mockResolvedValueOnce(json({ error: 'temporarily_unavailable' }, 503));
    const failed = await app.request(ORIGIN + PATH + '?account_id=account-1', { method: 'DELETE' }, env);
    expect(failed.status).toBe(502);
    expect(writes).toHaveLength(0);
    mocked.mockResolvedValueOnce(json({ ok: true }));
    const success = await app.request(ORIGIN + PATH + '?account_id=account-1', { method: 'DELETE' }, env);
    expect(success.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain('refresh_token = NULL');
    expect(JSON.parse(mocked.mock.calls[0][1]?.body as string)).toEqual({ action: 'revoke', refreshToken: 'lhc1.encrypted' });
  });

});
