/** Server-to-server Calendar OAuth bridge. Google client secrets stay in Cloud. */
export interface CalendarBrokerCredentials {
  calendarBrokerUrl?: string;
  calendarTenantId?: string;
  calendarBrokerSecret?: string;
}

export function calendarBrokerConfigured(credentials: CalendarBrokerCredentials): boolean {
  if (!credentials.calendarTenantId?.trim() || !credentials.calendarBrokerSecret?.trim()) return false;
  try {
    const url = new URL(credentials.calendarBrokerUrl ?? '');
    return url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export const isBrokerRefreshToken = (token: string) => token.startsWith('lhc1.');

export async function calendarBrokerRequest<T>(
  credentials: CalendarBrokerCredentials,
  operation: 'start' | 'token' | 'status',
  body?: Record<string, string>,
): Promise<T> {
  if (!calendarBrokerConfigured(credentials)) throw new Error('google_calendar_broker_not_configured');
  const response = await fetch(new URL(`/calendar/oauth/tenant/${operation}`, credentials.calendarBrokerUrl), {
    method: operation === 'status' ? 'GET' : 'POST',
    // Workers supports manual/follow only; reject non-2xx below without forwarding secrets.
    redirect: 'manual', signal: AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.calendarBrokerSecret}`,
      'X-Calendar-Tenant': credentials.calendarTenantId!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`google_calendar_broker_failed:${response.status}`);
  return response.json<T>();
}

export async function calendarBrokerAvailable(credentials: CalendarBrokerCredentials): Promise<boolean> {
  if (!calendarBrokerConfigured(credentials)) return false;
  try {
    const result = await calendarBrokerRequest<{ configured: boolean }>(credentials, 'status');
    return result.configured === true;
  } catch { return false; }
}

export function calendarCredentialsFromEnv(env: {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string; GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_CALENDAR_BROKER_URL?: string; GOOGLE_CALENDAR_TENANT_ID?: string; GOOGLE_CALENDAR_BROKER_SECRET?: string;
}) {
  return {
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID, oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    calendarBrokerUrl: env.GOOGLE_CALENDAR_BROKER_URL, calendarTenantId: env.GOOGLE_CALENDAR_TENANT_ID,
    calendarBrokerSecret: env.GOOGLE_CALENDAR_BROKER_SECRET,
  };
}
