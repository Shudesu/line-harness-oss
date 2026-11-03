/** Spec 08: byte-compatible with IG Harness's issueIgLinkToken. */
export interface IgLinkTokenEnv {
  IG_LINK_TOKEN_SECRET?: string;
  IG_HARNESS_LINK_SECRET?: string;
  IG_LINK_TOKEN_POLICY?: string;
}
export interface IgLinkPayload {
  v: 1;
  igsid: string;
  iga?: string;
  exp: number;
  n: string;
}
export const IG_LINK_TOKEN_TTL = 7 * 86400;
const encoder = new TextEncoder();
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(part: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  // Reject padding, nonzero trailing bits, and noncanonical encodings.
  if (base64url(bytes) !== part) throw new Error('Invalid encoding');
  return bytes;
}
async function keyBytes(env: IgLinkTokenEnv): Promise<Uint8Array<ArrayBuffer> | null> {
  if (env.IG_LINK_TOKEN_SECRET) return encoder.encode(env.IG_LINK_TOKEN_SECRET);
  if (!env.IG_HARNESS_LINK_SECRET) return null;
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.IG_HARNESS_LINK_SECRET), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: encoder.encode('ig-link-token-v1'),
  }, key, 256));
}
function validPayload(p: unknown, seconds: number): p is IgLinkPayload {
  if (!p || typeof p !== 'object') return false;
  const v = p as IgLinkPayload;
  return v.v === 1 && typeof v.igsid === 'string' && v.igsid.length > 0 && v.igsid.length <= 128
    && (v.iga === undefined || (typeof v.iga === 'string' && v.iga.length > 0 && v.iga.length <= 128))
    && Number.isSafeInteger(v.exp) && v.exp > seconds && v.exp <= seconds + IG_LINK_TOKEN_TTL
    && typeof v.n === 'string' && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(v.n);
}
/** now is milliseconds since epoch, as in the IG issuer's Date.now(). */
export async function verifyIgLinkToken(env: IgLinkTokenEnv, token: unknown, now = Date.now()): Promise<IgLinkPayload | null> {
  try {
    if (typeof token !== 'string' || token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = decode(parts[0]!);
    const signature = decode(parts[1]!);
    if (signature.length !== 32) return null;
    const bytes = await keyBytes(env);
    if (!bytes) return null;
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(parts[0]!))) return null;
    const p: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
    return validPayload(p, Math.floor(now / 1000)) ? p : null;
  } catch { return null; }
}
/** Reference issuer for tests/integrators; secrets are never included in payloads. */
export async function issueIgLinkToken(env: IgLinkTokenEnv, igsid: string, iga?: string, now = Date.now()): Promise<string | null> {
  const bytes = await keyBytes(env);
  if (!bytes) return null;
  const payload: IgLinkPayload = { v: 1, igsid, ...(iga ? { iga } : {}),
    exp: Math.floor(now / 1000) + IG_LINK_TOKEN_TTL, n: base64url(crypto.getRandomValues(new Uint8Array(16))) };
  if (!validPayload(payload, Math.floor(now / 1000))) return null;
  const part = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return part + '.' + base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(part))));
}
