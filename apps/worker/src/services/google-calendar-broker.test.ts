import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarBrokerAvailable, calendarBrokerRequest } from './google-calendar-broker.js';

const credentials = {
  calendarBrokerUrl: 'https://cloud.example',
  calendarTenantId: 'aaaaaaaaaaaa',
  calendarBrokerSecret: 'tenant-secret',
};
afterEach(() => vi.restoreAllMocks());

describe('Calendar broker transport', () => {
  it('checks availability using a redirect mode supported by Workers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      // Production Workers rejects redirect: error before making a network request.
      if (init?.redirect === 'error') throw new TypeError('Invalid redirect value');
      return Response.json({ configured: true });
    });
    await expect(calendarBrokerAvailable(credentials)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it.each(['status', 'start', 'token'] as const)('rejects redirects for %s without forwarding credentials', async (operation) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {
      status: 307, headers: { Location: 'https://unexpected.example' },
    }));
    await expect(calendarBrokerRequest(credentials, operation)).rejects.toThrow('google_calendar_broker_failed:307');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');
  });

  it('reports a failed authenticated availability check as unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
    await expect(calendarBrokerAvailable(credentials)).resolves.toBe(false);
  });
});
