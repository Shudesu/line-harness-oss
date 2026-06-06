/**
 * APNs (Apple Push Notification service) からのプッシュ通知配信。
 *
 * Cloudflare Workers から HTTP/2 で APNs に直接配信する。
 * Firebase 等の中継ナシ → エルメ iPhone アプリの「通知不安定」不満を構造的に解決。
 *
 * 認証: JWT (ES256)。Apple Developer の APNs Auth Key (.p8) を使う。
 * Cloudflare wrangler secret で以下を設定:
 *   - APNS_TEAM_ID:    Apple Developer Team ID (10桁英数字)
 *   - APNS_KEY_ID:     APNs Auth Key ID (10桁英数字)
 *   - APNS_AUTH_KEY:   .p8 ファイルの中身 (BEGIN PRIVATE KEY ... END PRIVATE KEY)
 *   - APNS_BUNDLE_ID:  アプリの bundle id (例: tech.maedayasao.hyhome-harness-ios)
 *
 * 環境変数で sandbox/production を区別、device_tokens.environment で振り分け。
 */

import type { DeviceToken } from '@line-crm/db';
import { touchDeviceTokenUsage, deleteDeviceToken } from '@line-crm/db';

const PROD_HOST = 'https://api.push.apple.com';
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com';

interface ApnsSecrets {
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_AUTH_KEY?: string;
  APNS_BUNDLE_ID?: string;
}

interface ApnsPayload {
  alert: { title: string; body: string };
  badge?: number;
  sound?: string;
  threadId?: string;
  customData?: Record<string, unknown>;
}

let cachedJwt: { token: string; expiresAt: number } | null = null;

/**
 * APNs JWT は ES256 で、有効期限 1 時間。再生成は20分ごとに推奨される。
 * Cloudflare Workers は再利用できないので、isolated request 単位だが、
 * 同 isolate 内で複数通知を送るケースのみキャッシュ有効。
 */
async function generateApnsJwt(secrets: Required<ApnsSecrets>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.expiresAt - 60 > now) {
    return cachedJwt.token;
  }

  const header = { alg: 'ES256', kid: secrets.APNS_KEY_ID };
  const payload = { iss: secrets.APNS_TEAM_ID, iat: now };

  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const message = `${b64url(header)}.${b64url(payload)}`;

  // .p8 から CryptoKey に変換
  const pem = secrets.APNS_AUTH_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(message),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const token = `${message}.${sigB64}`;

  cachedJwt = { token, expiresAt: now + 50 * 60 };
  return token;
}

/**
 * 単一デバイスへの通知配信。
 * 410 (Unregistered) を受けたら token を DB から削除（端末アプリ削除済の自動掃除）。
 */
async function pushToOneDevice(
  db: D1Database,
  device: DeviceToken,
  payload: ApnsPayload,
  secrets: Required<ApnsSecrets>,
): Promise<{ ok: boolean; status: number; reason?: string }> {
  const host = device.environment === 'production' ? PROD_HOST : SANDBOX_HOST;
  const url = `${host}/3/device/${device.token}`;
  const jwt = await generateApnsJwt(secrets);

  const apsBody = {
    aps: {
      alert: payload.alert,
      badge: payload.badge,
      sound: payload.sound ?? 'default',
      'thread-id': payload.threadId,
    },
    ...payload.customData,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': device.bundle_id,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify(apsBody),
  });

  if (resp.ok) {
    await touchDeviceTokenUsage(db, device.token);
    return { ok: true, status: resp.status };
  }

  // 410 Unregistered = アプリ削除/通知許可解除済。token を掃除。
  if (resp.status === 410) {
    await deleteDeviceToken(db, device.token);
    return { ok: false, status: 410, reason: 'unregistered_token_removed' };
  }

  let reason = '';
  try {
    const json = (await resp.json()) as { reason?: string };
    reason = json.reason ?? '';
  } catch {
    /* ignore */
  }
  return { ok: false, status: resp.status, reason };
}

/**
 * 公開エンドポイント: 複数デバイスに同じ通知を配信する。
 * 設定 (APNS_*) が無い環境では何もせず終了。
 */
export async function pushToDevices(
  db: D1Database,
  env: ApnsSecrets,
  devices: DeviceToken[],
  payload: ApnsPayload,
): Promise<{ sent: number; failed: number; results: Array<{ token: string; status: number; reason?: string }> }> {
  const results: Array<{ token: string; status: number; reason?: string }> = [];
  let sent = 0;
  let failed = 0;

  if (!env.APNS_TEAM_ID || !env.APNS_KEY_ID || !env.APNS_AUTH_KEY || !env.APNS_BUNDLE_ID) {
    // 設定不足 = まだ APNs 設定してない環境（dev 等）→ no-op で正常終了。
    return { sent: 0, failed: 0, results: [] };
  }

  const secrets: Required<ApnsSecrets> = {
    APNS_TEAM_ID: env.APNS_TEAM_ID,
    APNS_KEY_ID: env.APNS_KEY_ID,
    APNS_AUTH_KEY: env.APNS_AUTH_KEY,
    APNS_BUNDLE_ID: env.APNS_BUNDLE_ID,
  };

  // iOS のみ対象（Android は別途 FCM 実装）
  const iosDevices = devices.filter((d) => d.platform === 'ios');

  for (const d of iosDevices) {
    try {
      const r = await pushToOneDevice(db, d, payload, secrets);
      results.push({ token: d.token.slice(0, 16) + '...', status: r.status, reason: r.reason });
      if (r.ok) sent++;
      else failed++;
    } catch (err) {
      failed++;
      results.push({
        token: d.token.slice(0, 16) + '...',
        status: 0,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, failed, results };
}
