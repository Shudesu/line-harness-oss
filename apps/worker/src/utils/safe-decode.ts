/**
 * decodeURIComponent throws on malformed percent escapes (e.g. a lone `%`).
 * Callers that receive client-controlled strings (cookie values, URL path
 * segments) use this to fall back to the raw value rather than letting the
 * exception turn a request into a 500.
 */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
