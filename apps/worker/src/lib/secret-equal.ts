import { timingSafeEqual } from 'node:crypto';

/** Compare UTF-8 credentials without content-dependent early exit. Length is public. */
export function secretEqual(left: string, right: string | undefined): boolean {
  if (!right) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
