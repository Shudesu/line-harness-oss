/**
 * L-TRACK 互換: 外部イベント (EC等からの成果ポストバック受信)
 *
 * Codex指摘対応:
 *  - 認証は HMAC 署名（X-Signature ヘッダ）で検証。hmac_secret 設定があれば必須。
 *  - body は JSON / form のみ許可、Content-Length 制限。
 *  - multi-account 境界: external_events.line_account_id と friend.line_account_id を照合。
 *  - rawPayload は PII 関連キーをマスクしてから保存。
 *  - CAPI へは ad-conversion.ts 経由で実送信（test_mode 経路も活用）。
 */

import { Hono } from 'hono';
import {
  getExternalEventByKey,
  getExternalEvents,
  createExternalEvent,
  logExternalEventReceipt,
  getExternalEventReceipts,
  getFriendByLineUserId,
  getFriendByLineUserIdLegacy,
} from '@line-crm/db';
import { sendAdConversionsExplicit } from '../services/ad-conversion.js';
import type { Env } from '../index.js';

export const externalEvents = new Hono<Env>();

// 受信 body のサイズ上限（バイト）。これを超えるリクエストは 413 で拒否。
const MAX_BODY_BYTES = 32 * 1024;

// rawPayload に残すと危険なキー名（部分一致）
const PII_KEY_PATTERN = /(token|secret|password|auth|cookie|email|tel|phone|address|name|zip|postal|card|cvv|ssn)/i;

function maskPayload(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => maskPayload(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_KEY_PATTERN.test(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object') {
      out[k] = maskPayload(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * HMAC-SHA256 検証。secret 未設定なら true (dev向け、運用は必ず設定する)。
 * 期待ヘッダ: X-Signature: t=<unix>,v1=<hex>
 * 署名対象: `${t}.${rawBody}`、秘密は external_events.hmac_secret
 * リプレイ抑止: t が現在時刻から ±5 分以内
 */
async function verifyHmac(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  if (!secret) return { ok: true };
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, p) => {
    const [k, v] = p.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return { ok: false, reason: 'malformed_signature' };
  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid_timestamp' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 300) return { ok: false, reason: 'timestamp_skew' };

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // 定数時間比較
  if (expected.length !== v1.length) return { ok: false, reason: 'signature_mismatch' };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

externalEvents.get('/api/external-events', async (c) => {
  const lineAccountId = c.req.query('lineAccountId') ?? null;
  const items = await getExternalEvents(c.env.DB, { lineAccountId });
  return c.json({ success: true, data: items });
});

externalEvents.post('/api/external-events', async (c) => {
  const body = await c.req.json<{
    eventKey: string;
    name: string;
    lineAccountId?: string | null;
    capiPlatform?: 'meta' | 'google' | 'tiktok' | 'x' | null;
    capiEventName?: string | null;
    defaultValue?: number | null;
    memo?: string | null;
  }>();
  if (!body.eventKey || !body.name) {
    return c.json({ success: false, error: 'eventKey and name are required' }, 400);
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(body.eventKey)) {
    return c.json({ success: false, error: 'eventKey must match /^[a-zA-Z0-9_-]{1,64}$/' }, 400);
  }
  try {
    const ev = await createExternalEvent(c.env.DB, body);
    return c.json({ success: true, data: ev }, 201);
  } catch (err) {
    console.error('[external-events] create error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

externalEvents.get('/api/external-events/receipts', async (c) => {
  const eventId = c.req.query('eventId') ?? undefined;
  const limit = Math.min(500, Number(c.req.query('limit') ?? 200));
  const items = await getExternalEventReceipts(c.env.DB, { eventId, limit });
  return c.json({ success: true, data: items });
});

/**
 * 公開エンドポイント: EC カート等が叩く受信エンドポイント。
 * 認証: X-Signature ヘッダで HMAC-SHA256 検証（hmac_secret 設定時）。
 * Body: JSON or x-www-form-urlencoded のみ。multipart は拒否。
 */
externalEvents.post('/api/external-events/:eventKey/receive', async (c) => {
  const eventKey = c.req.param('eventKey');
  const ev = await getExternalEventByKey(c.env.DB, eventKey);
  if (!ev) {
    return c.json({ success: false, error: 'event not found' }, 404);
  }

  // Content-Length / Content-Type ガード
  const ct = (c.req.header('content-type') ?? '').toLowerCase();
  if (ct.includes('multipart/')) {
    return c.json({ success: false, error: 'multipart not allowed' }, 415);
  }
  const cl = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) {
    return c.json({ success: false, error: 'body too large' }, 413);
  }

  // Raw text を取り、HMAC 検証後にパースする
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return c.json({ success: false, error: 'body too large' }, 413);
  }

  // 【C3 監査対応 2026-06-06】hmac_secret 未設定の event は受信を拒否。
  // 以前は NULL で検証スキップ → 偽 CV を Meta/Google CAPI に流せる重大欠陥だった。
  // event を作成する際に必ず hmac_secret を設定すること（管理画面で必須化要）。
  if (!ev.hmac_secret) {
    return c.json({
      success: false,
      error: 'external event has no hmac_secret configured — refusing receipt',
    }, 400);
  }

  const sig = c.req.header('x-signature');
  const hmacCheck = await verifyHmac(raw, sig, ev.hmac_secret);
  if (!hmacCheck.ok) {
    return c.json({ success: false, error: `unauthorized: ${hmacCheck.reason}` }, 401);
  }

  // Body parse
  let body: Record<string, unknown> = {};
  try {
    if (ct.includes('application/json')) {
      body = raw ? JSON.parse(raw) : {};
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(raw);
      params.forEach((v, k) => {
        body[k] = v;
      });
    } else if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        return c.json({ success: false, error: 'unsupported content-type' }, 415);
      }
    }
  } catch {
    return c.json({ success: false, error: 'invalid body' }, 400);
  }

  const lineUserId =
    String(body.lineid ?? body.line_user_id ?? body.lineUserId ?? '').trim();
  if (!lineUserId) {
    return c.json({ success: false, error: 'lineid required' }, 400);
  }

  const fbclid = body.fbclid != null ? String(body.fbclid) : null;
  const gclid = body.gclid != null ? String(body.gclid) : null;
  const ttclid = body.ttclid != null ? String(body.ttclid) : null;
  const twclid = body.twclid != null ? String(body.twclid) : null;
  const eventValue =
    body.value != null && !Number.isNaN(Number(body.value))
      ? Math.floor(Number(body.value))
      : ev.default_value ?? null;

  // multi-account 境界: external_event が account 指定されていれば、その account の
  // friend のみ厳密 match。未指定 (ev.line_account_id IS NULL) は any-account 扱い
  // で legacy fallback。後段に「friend と ev の line_account_id が食い違うなら null」
  // の既存ガードを残してあり、ev.line_account_id NULL + 異なる account の friend に
  // 当たっても CAPI 紐付けはされない。
  const friend = ev.line_account_id
    ? await getFriendByLineUserId(c.env.DB, lineUserId, ev.line_account_id)
    : await getFriendByLineUserIdLegacy(c.env.DB, lineUserId);
  let friendId: string | null = friend?.id ?? null;
  if (
    friend &&
    ev.line_account_id &&
    (friend as { line_account_id?: string | null }).line_account_id &&
    (friend as { line_account_id?: string | null }).line_account_id !== ev.line_account_id
  ) {
    // 別アカウントの friend だった → 紐付けない
    friendId = null;
  }

  // CAPI 実送信: ad-conversion.ts 経由で送る（test_mode の挙動も含む）
  let status: 'received' | 'capi_sent' | 'capi_failed' = 'received';
  let errorMessage: string | null = null;
  if (ev.capi_platform && friendId) {
    const clickId = (() => {
      switch (ev.capi_platform) {
        case 'meta':
          return fbclid;
        case 'google':
          return gclid;
        case 'tiktok':
          return ttclid;
        case 'x':
          return twclid;
        default:
          return null;
      }
    })();
    if (clickId) {
      try {
        await sendAdConversionsExplicit(c.env.DB, {
          platformName: ev.capi_platform,
          friendId,
          eventName: ev.capi_event_name ?? 'ExternalEvent',
          clickIdType: ev.capi_platform === 'meta' ? 'fbclid' : ev.capi_platform === 'google' ? 'gclid' : ev.capi_platform === 'tiktok' ? 'ttclid' : 'twclid',
          clickId,
          eventValue: eventValue ?? undefined,
        });
        status = 'capi_sent';
      } catch (err) {
        status = 'capi_failed';
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // PII マスクしてから保存
  const masked = JSON.stringify(maskPayload(body)).slice(0, 2000);

  await logExternalEventReceipt(c.env.DB, {
    externalEventId: ev.id,
    lineUserId,
    friendId,
    fbclid,
    gclid,
    ttclid,
    twclid,
    eventValue,
    rawPayload: masked,
    status,
    errorMessage,
  });

  return c.json({ success: true, data: { status, friendId } });
});
