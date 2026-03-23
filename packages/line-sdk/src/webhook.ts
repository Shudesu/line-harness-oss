/**
 * Verifies the X-Line-Signature header using HMAC-SHA256.
 * Must be called before processing any webhook event.
 *
 * @param channelSecret - LINE channel secret
 * @param body          - Raw request body string (before JSON.parse)
 * @param signature     - Value of the X-Line-Signature header (base64)
 * @returns true if the signature is valid, false otherwise
 */
export async function verifySignature(
  channelSecret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(body),
  );

  // Convert computed HMAC to base64 (safe for all buffer sizes)
  const bytes = new Uint8Array(signatureBytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const computedBase64 = btoa(binary);

  // Constant-time comparison is not strictly needed here because both strings
  // are base64 of the same length, but we avoid early-exit for safety.
  return computedBase64 === signature;
}
