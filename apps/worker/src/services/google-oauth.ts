import {
  getCalendarConnectionById,
  updateCalendarConnectionTokens,
  type GoogleCalendarConnectionRow,
} from '@line-crm/db';
import { resolveBindingValue, type SecretLike } from './bindings.js';

export interface GoogleOAuthEnv {
  GOOGLE_OAUTH_CLIENT_ID?: SecretLike;
  GOOGLE_OAUTH_CLIENT_SECRET?: SecretLike;
  GOOGLE_OAUTH_REDIRECT_URI?: SecretLike;
  API_KEY?: SecretLike;
}

export async function getUsableGoogleCalendarConnection(
  db: D1Database,
  connectionId: string,
  env: GoogleOAuthEnv,
): Promise<GoogleCalendarConnectionRow | null> {
  const conn = await getCalendarConnectionById(db, connectionId);
  if (!conn) return null;
  if (conn.access_token && !isExpiringSoon(conn.access_token_expires_at)) return conn;
  if (!conn.refresh_token) return conn.access_token ? conn : null;
  const clientId = await resolveBindingValue(env.GOOGLE_OAUTH_CLIENT_ID);
  const clientSecret = await resolveBindingValue(env.GOOGLE_OAUTH_CLIENT_SECRET);
  if (!clientId || !clientSecret) return conn.access_token ? conn : null;

  const refreshed = await refreshGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken: conn.refresh_token,
  });

  return updateCalendarConnectionTokens(db, conn.id, {
    accessToken: refreshed.accessToken,
    accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
    refreshToken: refreshed.refreshToken ?? conn.refresh_token,
  });
}

async function refreshGoogleAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google OAuth refresh failed ${res.status}: ${body}`);
  }

  const data = await res.json<{
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  }>();
  if (!data.access_token) throw new Error('Google OAuth refresh response missing access_token');

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
    refreshToken: data.refresh_token,
  };
}

export async function exchangeGoogleAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; expiresIn: number; refreshToken: string | null }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google OAuth code exchange failed ${res.status}: ${body}`);
  }

  const data = await res.json<{
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  }>();
  if (!data.access_token) throw new Error('Google OAuth code exchange response missing access_token');

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
    refreshToken: data.refresh_token ?? null,
  };
}

export async function signGoogleOAuthState(
  payload: { calendarId: string; returnTo?: string | null; exp: number },
  secret: string,
): Promise<string> {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyGoogleOAuthState(
  state: string,
  secret: string,
): Promise<{ calendarId: string; returnTo?: string | null; exp: number } | null> {
  const [encodedPayload, signature] = state.split('.');
  if (!encodedPayload || !signature) return null;
  const expected = await hmacSha256(encodedPayload, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as {
      calendarId: string;
      returnTo?: string | null;
      exp: number;
    };
    if (!payload.calendarId || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const expires = new Date(expiresAt).getTime();
  if (!Number.isFinite(expires)) return true;
  return expires - Date.now() < 5 * 60 * 1000;
}

async function hmacSha256(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
