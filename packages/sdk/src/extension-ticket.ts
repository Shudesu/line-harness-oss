/** WebCrypto-only extension ticket codec. Never an API credential. */
export interface ExtensionTicket {
  aud: string;
  iss: string;
  sub: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  acct?: string;
  iat: number;
  exp: number;
  jti: string;
}
const enc = new TextEncoder();
function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function unb64(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('malformed');
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
  if (b64(bytes) !== value) throw new Error('malformed');
  return bytes;
}
async function key(secret: string) {
  if (enc.encode(secret).length < 32)
    throw new Error('extension secret too short');
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function createExtensionTicket(
  input: Omit<ExtensionTicket, 'iat' | 'exp' | 'jti'>,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  const payload: ExtensionTicket = {
    ...input,
    iat: now,
    exp: now + 60,
    jti: b64(crypto.getRandomValues(new Uint8Array(16))),
  };
  const encoded = b64(enc.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    enc.encode(encoded),
  );
  return {
    ticket: encoded + '.' + b64(new Uint8Array(signature)),
    expiresAt: payload.exp,
  };
}
/** Call on the extension server. consumeJti MUST be an atomic, durable first-use
 * insert keyed by issuer/audience/JTI, with expiry. Returning false rejects replay. */
export async function verifyExtensionTicket(
  token: string,
  options: {
    secret: string;
    extensionId: string;
    issuer: string;
    now?: number;
    consumeJti: (payload: ExtensionTicket) => Promise<boolean>;
  },
): Promise<ExtensionTicket | null> {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const signature = unb64(parts[1]);
    if (
      signature.length !== 32 ||
      !(await crypto.subtle.verify(
        'HMAC',
        await key(options.secret),
        signature as BufferSource,
        enc.encode(parts[0]),
      ))
    )
      return null;
    const payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(unb64(parts[0])),
    ) as ExtensionTicket;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (
      payload.aud !== 'lh-ext:' + options.extensionId ||
      payload.iss !== options.issuer ||
      !Number.isSafeInteger(payload.iat) ||
      !Number.isSafeInteger(payload.exp) ||
      payload.iat > now + 5 ||
      payload.exp <= now ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 60 ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.name !== 'string' ||
      !['owner', 'admin', 'staff'].includes(payload.role) ||
      typeof payload.jti !== 'string' ||
      unb64(payload.jti).length !== 16
    )
      return null;
    if (
      typeof options.consumeJti !== 'function' ||
      !(await options.consumeJti(payload))
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}
