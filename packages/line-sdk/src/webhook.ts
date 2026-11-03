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
  if (!channelSecret || !/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(signature)) return false;
  try {
    const bytes = Uint8Array.from(atob(signature), ch => ch.charCodeAt(0));
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(channelSecret),
      {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
    return crypto.subtle.verify('HMAC',key,bytes,encoder.encode(body));
  } catch { return false; }
}
