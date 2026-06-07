/**
 * 広告CV送信サービス
 *
 * LINE内アクション発生時に、友だちの広告クリックIDを元に
 * 各広告媒体のConversion APIへオフラインCVを送信する。
 *
 * P1 緊急修正 (2026-06-07):
 *   1. fetch にタイムアウトが無く graph.facebook.com 等のハングで Worker 30秒制限に当たる
 *      → 全 fetch に AbortSignal.timeout(10_000) を付与。
 *   2. Meta CAPI に event_id idempotency key を付けていない → Meta 側 24h 窓 dedup が効かず
 *      重複 CV カウントの恐れ。各 platform に「決定的に同じ logical event なら同じ key」を
 *      生成して付与。
 *   3. 失敗時の error category (4xx vs 5xx vs network/timeout) を細分して logAdConversion の
 *      status に保存し、retry 可否判断のヒントにする。
 */

import {
  getActiveAdPlatforms,
  getRefTrackingWithClickIds,
  getRefTrackingById,
  logAdConversion,
  type AdPlatformConfig,
  type RefTracking,
} from '@line-crm/db';

/** 外部広告 API への fetch タイムアウト。Worker 30秒 wall 内に必ず収める。 */
const AD_CAPI_TIMEOUT_MS = 10_000;

/**
 * 失敗カテゴリ。ad_conversion_logs.status の細分値として使う。
 * - 'failed_client'  : 4xx (リクエスト不備) → retry 不可
 * - 'failed_server'  : 5xx (プラットフォーム側エラー) → retry 可能
 * - 'failed_timeout' : AbortSignal タイムアウト → retry 可能
 * - 'failed_network' : ネットワーク層エラー (DNS, TLS, etc) → retry 可能
 * - 'failed'         : 上記に分類不能の汎用失敗 (互換用)
 */
type FailedStatus = 'failed' | 'failed_client' | 'failed_server' | 'failed_timeout' | 'failed_network';

/**
 * CAPI 送信側で `throw` する独自エラー。`category` を持つので呼び出し元で
 * logAdConversion(status=…) に正確な値を書ける。message には HTTP status と body が入る。
 */
class AdCapiError extends Error {
  public readonly category: FailedStatus;
  public readonly httpStatus: number | null;
  constructor(category: FailedStatus, httpStatus: number | null, message: string) {
    super(message);
    this.name = 'AdCapiError';
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

/**
 * fetch ラッパ: AbortSignal.timeout + 4xx/5xx/network/timeout を AdCapiError に正規化。
 * 成功時は Response を返す (呼び出し側で body 必要なら読む)。
 */
async function adCapiFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(AD_CAPI_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new AdCapiError(
        'failed_timeout',
        null,
        `${label} timeout after ${AD_CAPI_TIMEOUT_MS}ms`,
      );
    }
    throw new AdCapiError('failed_network', null, `${label} network error: ${String(err)}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const category: FailedStatus =
      response.status >= 400 && response.status < 500 ? 'failed_client' : 'failed_server';
    throw new AdCapiError(category, response.status, `${label} error: ${response.status} ${body}`);
  }
  return response;
}

/**
 * Idempotency key を作る。同じ logical event (= same platform/friend/event/clickId) なら
 * 必ず同じ key になる決定的ハッシュ。SHA-256 → hex (32文字に切る) で各 API の長さ制限内に収める。
 *
 * 設計理由:
 *   - 乱数 UUID だと retry 時に別の key になり Meta 側 dedup が効かない。
 *   - friendId と clickId と eventName を含めるので、同じ友だち × 同じ広告 × 同じ event は
 *     どの retry でも同一 key になる。
 */
async function buildIdempotencyKey(
  platformName: string,
  friendId: string,
  eventName: string,
  clickId: string,
): Promise<string> {
  const text = `${platformName}|${friendId}|${eventName}|${clickId}`;
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.slice(0, 32);
}

/**
 * 冪等チェック: 同 platform × 同 friend × 同 event × 同 click_id で status='sent'
 * が既にあれば true。
 * 054_ad_conversion_idempotency.sql の partial UNIQUE と組み合わせて二重送信を防ぐ。
 */
async function alreadySent(
  db: D1Database,
  platformId: string,
  friendId: string,
  eventName: string,
  clickId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM ad_conversion_logs
        WHERE ad_platform_id = ? AND friend_id = ? AND event_name = ?
          AND click_id = ? AND status = 'sent'
        LIMIT 1`,
    )
    .bind(platformId, friendId, eventName, clickId)
    .first();
  return !!row;
}

async function sendOneRef(
  db: D1Database,
  ref: RefTracking,
  friendId: string,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const platforms = await getActiveAdPlatforms(db);
  for (const platform of platforms) {
    const config: AdPlatformConfig & { test_mode?: boolean | string } = JSON.parse(platform.config);
    // test_mode: 実 API は叩かず、'sent' ログだけ残す（検証/疎通用）。
    // config.test_mode が true / "true" / 1 / "1" のいずれかなら有効。
    const testMode =
      config.test_mode === true ||
      config.test_mode === 'true' ||
      String(config.test_mode) === '1';
    // クリックID 未保持なら何もしない。各 entry には platform 名を持たせ、
    // idempotency key 生成時の決定論的入力に使う。
    const clickIdAndType: Array<{
      id: string;
      type: string;
      send: (idempotencyKey: string) => Promise<void>;
    }> = [];
    switch (platform.name) {
      case 'meta':
        if (ref.fbclid)
          clickIdAndType.push({
            id: ref.fbclid,
            type: 'fbclid',
            send: (key) => sendMetaConversion(config, ref, eventName, eventValue, key),
          });
        break;
      case 'x':
        if (ref.twclid)
          clickIdAndType.push({
            id: ref.twclid,
            type: 'twclid',
            send: (key) => sendXConversion(config, ref, eventName, eventValue, key),
          });
        break;
      case 'google':
        if (ref.gclid)
          clickIdAndType.push({
            id: ref.gclid,
            type: 'gclid',
            send: (key) => sendGoogleConversion(config, ref, eventName, eventValue, key),
          });
        break;
      case 'tiktok':
        if (ref.ttclid)
          clickIdAndType.push({
            id: ref.ttclid,
            type: 'ttclid',
            send: (key) => sendTikTokConversion(config, ref, eventName, eventValue, key),
          });
        break;
    }
    for (const entry of clickIdAndType) {
      // Codex指摘: 冪等性。同 platform × friend × event × click_id で sent 済みは送らない。
      if (await alreadySent(db, platform.id, friendId, eventName, entry.id)) {
        continue;
      }
      // P1: idempotency key を決定的に生成 (retry されても同じ key になる)。
      // Meta CAPI の event_id で 24h 窓 dedup、他プラットフォームの client-side dedup にも使う。
      const idempotencyKey = await buildIdempotencyKey(
        platform.name,
        friendId,
        eventName,
        entry.id,
      );
      // test_mode: 実 API を叩かず 'sent' でログだけ残す。
      if (testMode) {
        await logAdConversion(db, {
          platformId: platform.id,
          friendId,
          eventName,
          clickId: entry.id,
          clickIdType: entry.type,
          status: 'sent',
          responseBody: JSON.stringify({ test_mode: true, value: eventValue ?? null, event_id: idempotencyKey }),
        });
        continue;
      }
      try {
        await entry.send(idempotencyKey);
        await logAdConversion(db, {
          platformId: platform.id,
          friendId,
          eventName,
          clickId: entry.id,
          clickIdType: entry.type,
          status: 'sent',
        });
      } catch (error) {
        // P1: failure category を細分して status に保存 (retry 可否のヒント)。
        // AdCapiError 以外 (想定外) は汎用 'failed' に倒す。
        const status: FailedStatus =
          error instanceof AdCapiError ? error.category : 'failed';
        await logAdConversion(db, {
          platformId: platform.id,
          friendId,
          eventName,
          clickId: entry.id,
          clickIdType: entry.type,
          status,
          errorMessage: String(error),
        });
      }
    }
  }
}

export async function sendAdConversions(
  db: D1Database,
  friendId: string,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const ref = await getRefTrackingWithClickIds(db, friendId);
  if (!ref) return;
  await sendOneRef(db, ref, friendId, eventName, eventValue);
}

/**
 * L-TRACK 互換 外部イベント用: platform 名 + clickId を直接指定して送る。
 * Codex指摘 High対応: 外部イベントが ad_conversion_logs に sent 表示するだけだった
 * 問題を、ad-conversion.ts と同じ alreadySent / test_mode 経路で送るよう統一。
 */
export async function sendAdConversionsExplicit(
  db: D1Database,
  opts: {
    platformName: 'meta' | 'google' | 'tiktok' | 'x';
    friendId: string;
    eventName: string;
    clickIdType: string;
    clickId: string;
    eventValue?: number;
  },
): Promise<void> {
  const platforms = await getActiveAdPlatforms(db);
  const platform = platforms.find((p) => p.name === opts.platformName);
  if (!platform) return;
  if (await alreadySent(db, platform.id, opts.friendId, opts.eventName, opts.clickId)) {
    return;
  }
  const config: AdPlatformConfig & { test_mode?: boolean | string } = JSON.parse(platform.config);
  const testMode =
    config.test_mode === true ||
    config.test_mode === 'true' ||
    String(config.test_mode) === '1';
  if (testMode) {
    await logAdConversion(db, {
      platformId: platform.id,
      friendId: opts.friendId,
      eventName: opts.eventName,
      clickId: opts.clickId,
      clickIdType: opts.clickIdType,
      status: 'sent',
      responseBody: JSON.stringify({ test_mode: true, value: opts.eventValue ?? null }),
    });
    return;
  }
  // 実 API 送信は platform に応じた sender を呼ぶ必要があるが、
  // 現状 ref_tracking ベースでしか実装していないため、外部イベント用は
  // ref_tracking を組み立てて sendOneRef に流す。
  const refLike: RefTracking = {
    id: 'external-' + opts.clickId,
    ref_code: 'external',
    friend_id: opts.friendId,
    entry_route_id: null,
    source_url: null,
    fbclid: opts.clickIdType === 'fbclid' ? opts.clickId : null,
    gclid: opts.clickIdType === 'gclid' ? opts.clickId : null,
    twclid: opts.clickIdType === 'twclid' ? opts.clickId : null,
    ttclid: opts.clickIdType === 'ttclid' ? opts.clickId : null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    user_agent: null,
    ip_address: null,
    ltp: null,
    country: null,
    created_at: '',
  };
  await sendOneRef(db, refLike, opts.friendId, opts.eventName, opts.eventValue);
}

/**
 * 遅延 CAPI 用: ref_tracking_id を直接指定して送る。
 * 友だちの「最新」を拾うのではなく、enqueue 時点の click ID を再現する。
 *
 * Codex指摘の High対応: 1h/3h/24h の間に同 friend が別広告を踏むと、
 * sendAdConversions(friendId) では最新クリックに切り替わってしまうため、
 * af_confirm_queue.ref_tracking_id を介してこちらを呼ぶ。
 */
export async function sendAdConversionsByRefTrackingId(
  db: D1Database,
  refTrackingId: string,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const ref = await getRefTrackingById(db, refTrackingId);
  if (!ref || !ref.friend_id) return;
  await sendOneRef(db, ref, ref.friend_id, eventName, eventValue);
}

async function sendMetaConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue: number | undefined,
  idempotencyKey: string,
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${config.pixel_id}/events`;

  const eventData: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    // P1: Meta 側 24h dedup を効かせる。同じ logical event は同じ key で送る。
    event_id: idempotencyKey,
    user_data: {
      fbc: `fb.1.${Date.now()}.${ref.fbclid}`,
      client_ip_address: ref.ip_address || undefined,
      client_user_agent: ref.user_agent || undefined,
    },
  };

  if (eventValue) {
    eventData.custom_data = { currency: 'JPY', value: eventValue };
  }

  const body: Record<string, unknown> = {
    data: [eventData],
    access_token: config.access_token,
  };

  if (config.test_event_code) {
    body.test_event_code = config.test_event_code;
  }

  await adCapiFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    'Meta CAPI',
  );
}

async function sendXConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue: number | undefined,
  idempotencyKey: string,
): Promise<void> {
  const url = 'https://ads-api.x.com/12/measurement/conversions';

  const body = {
    conversions: [{
      conversion_time: new Date().toISOString(),
      // P1: X Conversion API は event_id を client-side dedup key として扱う。
      // 決定論的 key を渡せば retry でも重複 CV にならない。
      event_id: idempotencyKey,
      identifiers: [{ twclid: ref.twclid }],
      conversion_id: config.pixel_id,
      event_name: eventName,
      ...(eventValue && { value: { currency: 'JPY', amount: String(eventValue) } }),
    }],
  };

  await adCapiFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // OAuth 1.0a signature required — placeholder for production implementation
      },
      body: JSON.stringify(body),
    },
    'X Conversion API',
  );
}

async function sendGoogleConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue: number | undefined,
  idempotencyKey: string,
): Promise<void> {
  const url = `https://googleads.googleapis.com/v17/customers/${config.customer_id}:uploadClickConversions`;

  const body = {
    conversions: [{
      gclid: ref.gclid,
      conversion_action: `customers/${config.customer_id}/conversionActions/${config.conversion_action_id}`,
      conversion_date_time: new Date().toISOString().replace('Z', '+09:00'),
      // P1: Google Ads は order_id (任意文字列) を transaction-level dedup key として
      // 扱う。同じ key で送ると同じ conversion とみなされる (公式ドキュメント
      // "Avoid duplicate conversions" 参照)。
      order_id: idempotencyKey,
      ...(eventValue && { conversion_value: eventValue, currency_code: 'JPY' }),
    }],
    partial_failure: true,
  };

  await adCapiFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.oauth_token}`,
        'developer-token': config.developer_token || '',
      },
      body: JSON.stringify(body),
    },
    'Google Ads API',
  );
}

async function sendTikTokConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue: number | undefined,
  idempotencyKey: string,
): Promise<void> {
  const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

  const body = {
    pixel_code: config.pixel_code,
    event: eventName,
    // P1: TikTok Events API も event_id で client-side dedup を行う。
    event_id: idempotencyKey,
    timestamp: new Date().toISOString(),
    context: {
      user_agent: ref.user_agent || '',
      ip: ref.ip_address || '',
    },
    properties: {
      ...(ref.ttclid && { ttclid: ref.ttclid }),
      ...(eventValue && { currency: 'JPY', value: eventValue }),
    },
  };

  await adCapiFetch(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': config.access_token || '',
      },
      body: JSON.stringify(body),
    },
    'TikTok Events API',
  );
}
