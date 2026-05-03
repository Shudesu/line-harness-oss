export type ReservationTokenScope = 'reservations:read' | 'reservation:read' | 'reservation:cancel';

export interface ReservationTokenPayload {
  scope: ReservationTokenScope;
  exp: number;
  lineUserId?: string;
  friendId?: string | null;
  userId?: string | null;
  lineAccountId?: string | null;
  reservationId?: string;
}

export async function signReservationToken(
  payload: ReservationTokenPayload,
  secret: string,
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export async function verifyReservationToken(
  token: string,
  secret: string,
  expectedScope: ReservationTokenScope,
): Promise<ReservationTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = await hmacSha256(`${encodedHeader}.${encodedPayload}`, secret);
  if (!timingSafeEqual(signature, expected)) return null;

  let payload: ReservationTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as ReservationTokenPayload;
  } catch {
    return null;
  }

  if (payload.scope !== expectedScope) return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function reservationTokenSecret(env: {
  API_KEY?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_LOGIN_CHANNEL_SECRET?: string;
}): string {
  return env.API_KEY || env.LINE_CHANNEL_SECRET || env.LINE_LOGIN_CHANNEL_SECRET || 'line-harness-reservation-dev-secret';
}

export function secondsFromNow(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
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
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
