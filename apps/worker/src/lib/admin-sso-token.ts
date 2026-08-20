/**
 * Signed, single-use tokens for external admin SSO (`GET /admin/sso?token=…`).
 *
 * The feature lets an operator-controlled issuer (a self-hosted portal, an
 * internal IdP bridge, an ops tool, …) hand a browser a short-lived token
 * that the Worker exchanges for the SAME admin session an API-key login
 * issues. The issuer and the Worker share one secret (`ADMIN_SSO_SECRET`);
 * no round trip between them is needed.
 *
 * Token format (stable — external issuers depend on it):
 *
 *   token       = base64url(payloadJson) "." base64url(signature)
 *   payloadJson = UTF-8 JSON, e.g.
 *                 {"aud":"admin-sso","exp":1735689600,"iat":1735689540,
 *                  "jti":"4f1c…","sub":"ops@example.com"}
 *   signature   = HMAC-SHA256(key = ADMIN_SSO_SECRET (UTF-8 bytes),
 *                             message = base64url(payloadJson) (ASCII bytes))
 *
 * Note that the signature covers the *encoded* payload segment exactly as it
 * appears in the token (JWS convention), not the raw JSON bytes. That removes
 * any dependence on JSON canonicalisation: the verifier never re-serialises.
 *
 * Both base64url encodings are unpadded (`=` stripped) and use the URL-safe
 * alphabet (`-` and `_`).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Required `aud` value. Binds a token to this feature and no other. */
export const ADMIN_SSO_AUDIENCE = 'admin-sso';

/**
 * Maximum accepted lifetime (`exp - iat`). Tokens travel in a URL — they land
 * in browser history, referrer headers and proxy logs — so a long-lived one is
 * a long-lived credential. Issuers must mint them just-in-time.
 */
export const ADMIN_SSO_MAX_TTL_SECONDS = 300;

/**
 * Tolerance for an issuer clock that runs ahead. Without this bound an issuer
 * could set `iat` far in the future and satisfy the TTL check with a token
 * that stays valid for hours relative to the Worker's clock.
 */
export const ADMIN_SSO_MAX_CLOCK_SKEW_SECONDS = 60;

/** Minimum `ADMIN_SSO_SECRET` length, in characters (≥ 32 bytes of secret). */
export const ADMIN_SSO_MIN_SECRET_LENGTH = 32;

/** `jti` shape. Bounded so a hostile issuer cannot bloat the replay table. */
const JTI_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;

/** `sub` is display/audit only — never an authorization input. */
const MAX_SUB_LENGTH = 200;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface AdminSsoPayload {
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  sub?: string;
}

/** Why a token was rejected. Logged for audit; never returned to the client. */
export type AdminSsoRejection =
  | 'malformed'
  | 'bad_signature'
  | 'bad_audience'
  | 'bad_jti'
  | 'bad_sub'
  | 'future_iat'
  | 'ttl_too_long'
  | 'expired';

export type AdminSsoVerifyResult =
  | { ok: true; payload: AdminSsoPayload }
  | { ok: false; reason: AdminSsoRejection };

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(value)) return null;
  const padding = (4 - (value.length % 4)) % 4;
  const standard = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(padding);
  try {
    const binary = atob(standard);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64UrlEncode(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Reference issuer implementation. Exported so self-hosted issuers written in
 * TypeScript can reuse it verbatim, and so the tests sign with the same code
 * path an external issuer would.
 */
export async function signAdminSsoToken(
  secret: string,
  payload: AdminSsoPayload,
): Promise<string> {
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${encodedPayload}.${await hmac(secret, encodedPayload)}`;
}

/**
 * Verify signature + claims. Replay prevention is NOT handled here — the caller
 * must additionally burn `payload.jti` in durable storage (see
 * `consumeAdminSsoJti` in @line-crm/db).
 */
export async function verifyAdminSsoToken(
  secret: string,
  token: string,
  nowEpochSeconds: number,
): Promise<AdminSsoVerifyResult> {
  if (!secret) return { ok: false, reason: 'malformed' };

  const separator = token.indexOf('.');
  if (separator <= 0 || separator !== token.lastIndexOf('.')) {
    return { ok: false, reason: 'malformed' };
  }
  const encodedPayload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!signature || !BASE64URL_PATTERN.test(signature)) {
    return { ok: false, reason: 'malformed' };
  }
  if (!BASE64URL_PATTERN.test(encodedPayload)) {
    return { ok: false, reason: 'malformed' };
  }

  // Authenticate before parsing: never hand unverified bytes to JSON.parse.
  const expected = await hmac(secret, encodedPayload);
  if (!timingSafeEqual(expected, signature)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const bytes = base64UrlDecode(encodedPayload);
  if (!bytes) return { ok: false, reason: 'malformed' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'malformed' };
  }

  const claims = parsed as Record<string, unknown>;
  if (claims.aud !== ADMIN_SSO_AUDIENCE) {
    return { ok: false, reason: 'bad_audience' };
  }
  if (!Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)) {
    return { ok: false, reason: 'malformed' };
  }
  const exp = claims.exp as number;
  const iat = claims.iat as number;

  if (typeof claims.jti !== 'string' || !JTI_PATTERN.test(claims.jti)) {
    return { ok: false, reason: 'bad_jti' };
  }
  if (
    claims.sub !== undefined &&
    (typeof claims.sub !== 'string' || claims.sub.length > MAX_SUB_LENGTH)
  ) {
    return { ok: false, reason: 'bad_sub' };
  }

  if (iat > nowEpochSeconds + ADMIN_SSO_MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'future_iat' };
  }
  if (exp <= iat || exp - iat > ADMIN_SSO_MAX_TTL_SECONDS) {
    return { ok: false, reason: 'ttl_too_long' };
  }
  if (exp <= nowEpochSeconds) {
    return { ok: false, reason: 'expired' };
  }

  const payload: AdminSsoPayload = {
    aud: ADMIN_SSO_AUDIENCE,
    exp,
    iat,
    jti: claims.jti,
  };
  if (typeof claims.sub === 'string') payload.sub = claims.sub;
  return { ok: true, payload };
}
