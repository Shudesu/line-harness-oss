const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

export interface GoogleServiceAccountCredentials {
  email?: string;
  privateKey?: string;
}

type CachedToken = { accessToken: string; expiresAtMs: number; email: string };
let cachedToken: CachedToken | null = null;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, '\n').trim();
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  if (!body) throw new Error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is invalid');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Mint a short-lived OAuth token from an instance-level Google service account.
 * The private key never enters D1 or the admin browser. Calendar owners only
 * need to share their calendar with the service-account email and save its ID.
 */
export async function getGoogleServiceAccountToken(
  credentials: GoogleServiceAccountCredentials,
): Promise<string> {
  const email = credentials.email?.trim();
  const privateKey = credentials.privateKey?.trim();
  if (!email || !privateKey) {
    throw new Error('google_service_account_not_configured');
  }

  if (cachedToken && cachedToken.email === email && cachedToken.expiresAtMs > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJson({
    iss: email,
    scope: CALENDAR_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`google_service_account_token_failed:${response.status}:${detail.slice(0, 300)}`);
  }
  const data = await response.json<{ access_token?: string; expires_in?: number }>();
  if (!data.access_token) throw new Error('google_service_account_token_missing');
  cachedToken = {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
    email,
  };
  return data.access_token;
}

export function resetGoogleServiceAccountTokenCacheForTest(): void {
  cachedToken = null;
}
