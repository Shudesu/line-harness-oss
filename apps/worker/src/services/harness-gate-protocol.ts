/** xh.gate.v1: same implementation on both sides; fixtures exercise byte compatibility. */
export interface HarnessHeaders {
  event: string;
  deliveryId: string;
  timestamp: string;
  connectionId: string;
  signature: string;
}
const encoder = new TextEncoder();
export async function bodyDigest(body: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(body))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
function signingInput(
  method: string,
  path: string,
  headers: Omit<HarnessHeaders, 'signature'>,
  body: string,
): Promise<string> {
  return bodyDigest(body).then((hash) =>
    [
      'xh.gate.v1',
      method.toUpperCase(),
      path,
      headers.connectionId,
      headers.event,
      headers.deliveryId,
      headers.timestamp,
      hash,
    ].join('\n'),
  );
}
async function importKey(secret: string) {
  if (secret.length < 32) throw new Error('Integration secret must have at least 32 characters');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function signHarnessRequest(
  secret: string,
  method: string,
  path: string,
  body: string,
  identity: { connectionId: string; event: string; deliveryId?: string },
  now = Date.now(),
): Promise<Record<string, string>> {
  const h = {
    ...identity,
    deliveryId: identity.deliveryId ?? crypto.randomUUID(),
    timestamp: String(now),
  };
  const signature = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        await importKey(secret),
        encoder.encode(await signingInput(method, path, h, body)),
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  return {
    'Content-Type': 'application/json',
    'X-Harness-Connection-Id': h.connectionId,
    'X-Harness-Event': h.event,
    'X-Harness-Delivery-Id': h.deliveryId,
    'X-Harness-Timestamp': h.timestamp,
    'X-Harness-Signature': `sha256=${signature}`,
  };
}
export async function verifyHarnessRequest(
  secret: string,
  request: Request,
  body: string,
  expectedConnectionId: string,
  now = Date.now(),
): Promise<HarnessHeaders | null> {
  const h: HarnessHeaders = {
    connectionId: request.headers.get('X-Harness-Connection-Id') ?? '',
    event: request.headers.get('X-Harness-Event') ?? '',
    deliveryId: request.headers.get('X-Harness-Delivery-Id') ?? '',
    timestamp: request.headers.get('X-Harness-Timestamp') ?? '',
    signature: request.headers.get('X-Harness-Signature') ?? '',
  };
  if (
    h.connectionId !== expectedConnectionId ||
    !/^[a-z][a-z0-9._-]{0,80}$/.test(h.event) ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(h.deliveryId) ||
    !/^\d{13}$/.test(h.timestamp) ||
    Math.abs(now - Number(h.timestamp)) > 300000 ||
    !/^sha256=[0-9a-f]{64}$/.test(h.signature) ||
    encoder.encode(body).byteLength > 131072
  )
    return null;
  const bytes = Uint8Array.from(h.signature.slice(7).match(/../g)!, (s) => parseInt(s, 16));
  const path = new URL(request.url).pathname + new URL(request.url).search;
  try {
    return (await crypto.subtle.verify(
      'HMAC',
      await importKey(secret),
      bytes,
      encoder.encode(await signingInput(request.method, path, h, body)),
    ))
      ? h
      : null;
  } catch {
    return null;
  }
}
export function assertHttpsBase(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error('An HTTPS origin without credentials is required');
  return url.origin;
}
export const RETRY_DELAYS_MS = [60000, 300000, 1800000, 7200000, 43200000] as const;
