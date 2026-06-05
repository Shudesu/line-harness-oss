/**
 * 広告CV送信サービス
 *
 * LINE内アクション発生時に、友だちの広告クリックIDを元に
 * 各広告媒体のConversion APIへオフラインCVを送信する。
 */

import {
  getActiveAdPlatforms,
  getRefTrackingWithClickIds,
  getRefTrackingById,
  logAdConversion,
  type AdPlatformConfig,
  type RefTracking,
} from '@line-crm/db';

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
    const config: AdPlatformConfig = JSON.parse(platform.config);
    // クリックID 未保持なら何もしない。
    const clickIdAndType: Array<{ id: string; type: string; send: () => Promise<void> }> = [];
    switch (platform.name) {
      case 'meta':
        if (ref.fbclid)
          clickIdAndType.push({
            id: ref.fbclid,
            type: 'fbclid',
            send: () => sendMetaConversion(config, ref, eventName, eventValue),
          });
        break;
      case 'x':
        if (ref.twclid)
          clickIdAndType.push({
            id: ref.twclid,
            type: 'twclid',
            send: () => sendXConversion(config, ref, eventName, eventValue),
          });
        break;
      case 'google':
        if (ref.gclid)
          clickIdAndType.push({
            id: ref.gclid,
            type: 'gclid',
            send: () => sendGoogleConversion(config, ref, eventName, eventValue),
          });
        break;
      case 'tiktok':
        if (ref.ttclid)
          clickIdAndType.push({
            id: ref.ttclid,
            type: 'ttclid',
            send: () => sendTikTokConversion(config, ref, eventName, eventValue),
          });
        break;
    }
    for (const entry of clickIdAndType) {
      // Codex指摘: 冪等性。同 platform × friend × event × click_id で sent 済みは送らない。
      if (await alreadySent(db, platform.id, friendId, eventName, entry.id)) {
        continue;
      }
      try {
        await entry.send();
        await logAdConversion(db, {
          platformId: platform.id,
          friendId,
          eventName,
          clickId: entry.id,
          clickIdType: entry.type,
          status: 'sent',
        });
      } catch (error) {
        await logAdConversion(db, {
          platformId: platform.id,
          friendId,
          eventName,
          clickId: entry.id,
          clickIdType: entry.type,
          status: 'failed',
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
  eventValue?: number,
): Promise<void> {
  const url = `https://graph.facebook.com/v21.0/${config.pixel_id}/events`;

  const eventData: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Meta CAPI error: ${response.status} ${errorBody}`);
  }
}

async function sendXConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const url = 'https://ads-api.x.com/12/measurement/conversions';

  const body = {
    conversions: [{
      conversion_time: new Date().toISOString(),
      event_id: crypto.randomUUID(),
      identifiers: [{ twclid: ref.twclid }],
      conversion_id: config.pixel_id,
      event_name: eventName,
      ...(eventValue && { value: { currency: 'JPY', amount: String(eventValue) } }),
    }],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // OAuth 1.0a signature required — placeholder for production implementation
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`X Conversion API error: ${response.status} ${errorBody}`);
  }
}

async function sendGoogleConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const url = `https://googleads.googleapis.com/v17/customers/${config.customer_id}:uploadClickConversions`;

  const body = {
    conversions: [{
      gclid: ref.gclid,
      conversion_action: `customers/${config.customer_id}/conversionActions/${config.conversion_action_id}`,
      conversion_date_time: new Date().toISOString().replace('Z', '+09:00'),
      ...(eventValue && { conversion_value: eventValue, currency_code: 'JPY' }),
    }],
    partial_failure: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.oauth_token}`,
      'developer-token': config.developer_token || '',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Ads API error: ${response.status} ${errorBody}`);
  }
}

async function sendTikTokConversion(
  config: AdPlatformConfig,
  ref: RefTracking,
  eventName: string,
  eventValue?: number,
): Promise<void> {
  const url = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

  const body = {
    pixel_code: config.pixel_code,
    event: eventName,
    event_id: crypto.randomUUID(),
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': config.access_token || '',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`TikTok Events API error: ${response.status} ${errorBody}`);
  }
}
