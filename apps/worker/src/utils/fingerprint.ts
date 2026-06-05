/**
 * UA Fingerprint Generation
 *
 * L-TRACK 認証スキップモードで、クリック時のUAを正規化してハッシュ化することで、
 * follow webhook 受信時に同一デバイスかどうかを照合する（IPと併用）。
 *
 * 正規化方針: OS + ブラウザ + メジャーバージョンのみ抽出。
 * これにより同一デバイスの異なるアプリ間（Safari, LINE in-app browser など）も
 * ある程度同一視できる。
 */

const UA_PATTERNS = {
  // OS
  ios: /\b(iPhone|iPad|iPod) OS (\d+)/,
  android: /Android (\d+)/,
  windows: /Windows NT (\d+\.\d+)/,
  mac: /Mac OS X (\d+[._]\d+)/,
  // Browser
  chrome: /Chrome\/(\d+)/,
  safari: /Safari\/(\d+)/,
  firefox: /Firefox\/(\d+)/,
  edge: /Edg\/(\d+)/,
  line: /\bLine\/(\d+)/,
};

export function normalizeUa(ua: string): string {
  if (!ua) return '';
  const parts: string[] = [];

  if (UA_PATTERNS.ios.test(ua)) parts.push('ios:' + (ua.match(UA_PATTERNS.ios)?.[2] ?? ''));
  else if (UA_PATTERNS.android.test(ua)) parts.push('android:' + (ua.match(UA_PATTERNS.android)?.[1] ?? ''));
  else if (UA_PATTERNS.windows.test(ua)) parts.push('windows:' + (ua.match(UA_PATTERNS.windows)?.[1] ?? ''));
  else if (UA_PATTERNS.mac.test(ua)) parts.push('mac:' + (ua.match(UA_PATTERNS.mac)?.[1] ?? ''));

  if (UA_PATTERNS.line.test(ua)) parts.push('line:' + (ua.match(UA_PATTERNS.line)?.[1] ?? ''));
  else if (UA_PATTERNS.edge.test(ua)) parts.push('edge:' + (ua.match(UA_PATTERNS.edge)?.[1] ?? ''));
  else if (UA_PATTERNS.chrome.test(ua)) parts.push('chrome:' + (ua.match(UA_PATTERNS.chrome)?.[1] ?? ''));
  else if (UA_PATTERNS.firefox.test(ua)) parts.push('firefox:' + (ua.match(UA_PATTERNS.firefox)?.[1] ?? ''));
  else if (UA_PATTERNS.safari.test(ua)) parts.push('safari:' + (ua.match(UA_PATTERNS.safari)?.[1] ?? ''));

  return parts.length ? parts.join('|') : ua.slice(0, 64);
}

/**
 * SHA-256 → hex 文字列。Web Crypto API 使用（Cloudflare Workers 標準）。
 */
export async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * UA Fingerprint 生成: 正規化したUAを SHA-256 でハッシュ化。
 */
export async function generateUaFingerprint(ua: string): Promise<string> {
  return sha256(normalizeUa(ua));
}

/**
 * Bridge token 生成: 12文字の英数字。L-TRACK互換ではないが、
 * 認証スキップモードでクリック→friend追加を確定的に紐付ける追加チャネル。
 * LINE add-friend URL に `?text=lhm_<token>` で埋め込み、
 * 友だち追加直後のメッセージで送信されれば確定マッチ可能。
 */
export function generateBridgeToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => chars[b % chars.length]).join('');
}
