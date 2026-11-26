/** Compare byte values without data-dependent early exits. String secrets are
 * digested first so their final comparison always has the same length. */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const native = (crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean;
  }).timingSafeEqual;
  if (native && a.length === b.length) return native.call(crypto.subtle, a, b);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
}

export async function timingSafeEqualString(
  a: string | null | undefined,
  b: string | null | undefined,
): Promise<boolean> {
  if (!a || !b) return false;
  const encode = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(a)),
    crypto.subtle.digest('SHA-256', encode.encode(b)),
  ]);
  return timingSafeEqualBytes(new Uint8Array(left), new Uint8Array(right));
}
