export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const fields = signatureHeader.split(',').map((field) => field.trim().split('='));
  const timestamps = fields.filter(([name]) => name === 't');
  if (timestamps.length !== 1 || timestamps[0].length !== 2) return false;
  const timestamp = timestamps[0][1];
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  const signatures = fields
    .filter(([name, value, extra]) => name === 'v1' && !extra && /^[a-f0-9]{64}$/.test(value ?? ''))
    .map(([, value]) => value);
  if (signatures.length === 0) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const payload = encoder.encode(`${timestamp}.${rawBody}`);
  for (const signature of signatures) {
    const bytes = Uint8Array.from(signature.match(/../g)!, (hex) => parseInt(hex, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, payload)) return true;
  }
  return false;
}
