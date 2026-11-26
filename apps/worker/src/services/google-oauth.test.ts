import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildGoogleOAuthAuthorizationUrl,
  exchangeGoogleOAuthCode,
  GOOGLE_CALENDAR_OAUTH_SCOPE,
  refreshGoogleOAuthAccessToken,
  revokeGoogleOAuthToken,
  signGoogleOAuthState,
  verifyGoogleOAuthState,
} from './google-oauth.js';

afterEach(() => vi.unstubAllGlobals());

describe('Google OAuth', () => {
  test('authorization URL requests offline access and the narrow calendar scope', () => {
    const value = buildGoogleOAuthAuthorizationUrl({
      clientId: 'client-id',
      redirectUri: 'https://worker.example.com/callback',
      state: 'signed-state',
    });
    const url = new URL(value);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_OAUTH_SCOPE);
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
    ]);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    // このOAuthクライアントで過去に許可されたDrive/YouTube権限を混ぜない。
    expect(url.searchParams.has('include_granted_scopes')).toBe(false);
    expect(url.searchParams.get('state')).toBe('signed-state');
  });

  test('signed state round-trips and rejects tampering or expiry', async () => {
    const payload = { accountId: 'account-1', staffId: 'staff-1', expiresAt: 2_000 };
    const state = await signGoogleOAuthState(payload, 'state-secret');
    await expect(verifyGoogleOAuthState(state, 'state-secret', new Date(1_000)))
      .resolves.toEqual(payload);
    await expect(verifyGoogleOAuthState(`${state}x`, 'state-secret', new Date(1_000)))
      .rejects.toThrow('invalid_google_oauth_state');
    await expect(verifyGoogleOAuthState(state, 'state-secret', new Date(2_001)))
      .rejects.toThrow('invalid_google_oauth_state');
  });

  test('authorization code exchange requires a refresh token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(exchangeGoogleOAuthCode({
      code: 'code-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      redirectUri: 'https://worker.example.com/callback',
    })).resolves.toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(request.body)).toContain('grant_type=authorization_code');
  });

  test('refreshes and revokes without exposing credentials in the URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fresh-access' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshGoogleOAuthAccessToken({
      refreshToken: 'refresh-secret',
      clientId: 'client-1',
      clientSecret: 'client-secret',
    })).resolves.toBe('fresh-access');
    await revokeGoogleOAuthToken('refresh-secret');

    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    expect(fetchMock.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/revoke');
    expect(String(fetchMock.mock.calls[1][1]?.body)).toBe('token=refresh-secret');
  });
});
