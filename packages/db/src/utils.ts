/** JST offset: UTC+9 in milliseconds */
const JST_OFFSET_MS = 9 * 60 * 60_000;

/**
 * Returns current time as JST ISO 8601 string with +09:00 offset.
 * Format: YYYY-MM-DDTHH:mm:ss.sss+09:00
 *
 * All timestamps in this project are standardized to JST.
 * The +09:00 suffix ensures new Date() parses correctly for epoch comparisons.
 */
export function jstNow(): string {
  return toJstString(new Date());
}

/**
 * Convert a Date object to JST ISO 8601 string with +09:00 offset.
 * Format: YYYY-MM-DDTHH:mm:ss.sss+09:00
 */
export function toJstString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, -1) + '+09:00';
}

/**
 * Compare two timestamp strings (any format) as epoch milliseconds.
 * Handles both Z and +09:00 formats correctly.
 */
export function isTimeBefore(a: string, b: string): boolean {
  return new Date(a).getTime() <= new Date(b).getTime();
}
