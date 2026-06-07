/**
 * P1 (2026-06-07): LINE multicast / push の X-Line-Retry-Key 用 UUID 生成。
 *
 * LINE 公式仕様: X-Line-Retry-Key は UUID 形式 (8-4-4-4-12 hex)。1分以内に同じ key
 * の multicast が再来したら 200 を返しつつ実送信を抑制する dedup。
 *
 * cron double-fire や recoverStuck race で同じ batch が二重発射されても、決定論的
 * UUID を渡せばユーザーは 1 通しか受け取らない。
 *
 * 入力 (broadcast_id, batch_offset 等) を SHA-256 → 128 bit を取り出して RFC 4122
 * v8 (custom) 形式の UUID に整形。v8 はベンダー独自用途で衝突可能性は無視できる。
 */

/**
 * 任意文字列 (broadcast_id + batch_offset 等) を決定論的 UUID-v8 へ変換する。
 * 同じ入力なら必ず同じ UUID を返す。
 */
export async function buildRetryKey(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);

  // RFC 4122 variant + version 8 (experimental/custom)
  // byte 6 の上位 4 bit を version、 byte 8 の上位 2 bit を variant (10) に固定。
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // version 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
