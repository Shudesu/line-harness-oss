import type { GoogleServiceAccountCredentials } from './google-service-account.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// 予定の作成・変更とFreeBusy参照はGoogle上で別scope。広いcalendar scopeを避け、
// CTA予約に必要な2権限だけを要求する。
export const GOOGLE_CALENDAR_OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
].join(' ');

export interface GoogleOAuthClientCredentials {
  oauthClientId?: string;
  oauthClientSecret?: string;
}

export type GoogleCalendarCredentials = GoogleServiceAccountCredentials &
  GoogleOAuthClientCredentials;

export interface GoogleOAuthStatePayload {
  accountId: string;
  staffId: string;
  expiresAt: number;
  adminOrigin?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

export function googleOAuthConfigured(credentials: GoogleOAuthClientCredentials): boolean {
  return Boolean(credentials.oauthClientId?.trim() && credentials.oauthClientSecret?.trim());
}

export async function signGoogleOAuthState(
  payload: GoogleOAuthStatePayload,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error('google_oauth_state_secret_missing');
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${base64Url(await hmac(encoded, secret))}`;
}

export async function verifyGoogleOAuthState(
  state: string,
  secret: string,
  now: Date = new Date(),
): Promise<GoogleOAuthStatePayload> {
  const [encoded, signature, extra] = state.split('.');
  if (!encoded || !signature || extra || !secret) throw new Error('invalid_google_oauth_state');
  const expected = await hmac(encoded, secret);
  if (!timingSafeEqual(expected, decodeBase64Url(signature))) {
    throw new Error('invalid_google_oauth_state');
  }
  const payload = JSON.parse(
    new TextDecoder().decode(decodeBase64Url(encoded)),
  ) as Partial<GoogleOAuthStatePayload>;
  if (
    typeof payload.accountId !== 'string' ||
    typeof payload.staffId !== 'string' ||
    typeof payload.expiresAt !== 'number' ||
    (payload.adminOrigin !== undefined && typeof payload.adminOrigin !== 'string') ||
    payload.expiresAt < now.getTime()
  ) {
    throw new Error('invalid_google_oauth_state');
  }
  return payload as GoogleOAuthStatePayload;
}

export function buildGoogleOAuthAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: input.state,
  }).toString();
  return url.toString();
}

async function requestToken(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data: GoogleTokenResponse = await response
    .json<GoogleTokenResponse>()
    .catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      `google_oauth_token_failed:${response.status}:${data.error ?? 'unknown'}`,
    );
  }
  return data;
}

export async function exchangeGoogleOAuthCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const data = await requestToken(new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  }));
  if (!data.refresh_token) throw new Error('google_oauth_refresh_token_missing');
  return {
    accessToken: data.access_token!,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in ?? 3600,
  };
}

export async function refreshGoogleOAuthAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const data = await requestToken(new URLSearchParams({
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
  }));
  return data.access_token!;
}

export async function revokeGoogleOAuthToken(token: string): Promise<void> {
  const response = await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  // すでに失効しているトークンの400は、接続解除という目的を達成している。
  if (!response.ok && response.status !== 400) {
    throw new Error(`google_oauth_revoke_failed:${response.status}`);
  }
}
