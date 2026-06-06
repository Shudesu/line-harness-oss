/**
 * 監査 H1 対応: CRM forward サービス
 *
 * harness が LINE webhook を受信した時、設定された外部 CRM (エルメ等) に
 * 同じ payload を転送する。エルメ → harness 移行中の並行運用用。
 *
 * 重要: LINE webhook は 3秒以内に応答が必要なので、webhook handler 内では
 *       `c.executionCtx.waitUntil(forwardToAllCrms(...))` で非同期実行すること。
 *       この関数自体は意図的に長時間動作する想定 (各 forward 先に並列 POST)。
 *
 * - 各 forward 先には Promise.allSettled で並列送信
 * - タイムアウト: 10秒
 * - X-Line-Signature ヘッダを付け直す (attach_line_signature=1 のとき)
 */

import {
  getEnabledCrmForwards,
  logCrmForwardResult,
} from '@line-crm/db';

const TIMEOUT_MS = 10_000;

/**
 * 指定アカウント宛の webhook を全 forward 先に転送する。
 * waitUntil で呼ぶ前提。failしても LINE 応答は返した後なので問題なし。
 */
export async function forwardWebhookToCrms(
  db: D1Database,
  lineAccountId: string,
  rawBody: string,
  channelSecret: string | null,
): Promise<void> {
  const forwards = await getEnabledCrmForwards(db, lineAccountId);
  if (forwards.length === 0) return;

  // 各 forward 先に並列 POST
  await Promise.allSettled(
    forwards.map((fwd) => sendOne(db, fwd, rawBody, channelSecret)),
  );
}

async function sendOne(
  db: D1Database,
  fwd: {
    id: string;
    webhook_url: string;
    attach_line_signature: number;
  },
  rawBody: string,
  channelSecret: string | null,
): Promise<void> {
  const startedAt = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'hyhome-harness-crm-forwarder/1.0',
  };

  // attach_line_signature=1 のとき、X-Line-Signature を再計算して付与
  // エルメ等の forward 先が LINE 公式 webhook 互換のとき、署名検証で受け取れるように
  if (fwd.attach_line_signature && channelSecret) {
    try {
      const signature = await signLineHmac(rawBody, channelSecret);
      headers['X-Line-Signature'] = signature;
    } catch (err) {
      console.error('[crm-forward] signature error:', err);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(fwd.webhook_url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
    });
    const duration = Date.now() - startedAt;
    await logCrmForwardResult(db, {
      crmForwardId: fwd.id,
      status: r.ok ? 'sent' : 'failed',
      httpStatus: r.status,
      durationMs: duration,
      errorMessage: r.ok ? null : `HTTP ${r.status}`,
    });
  } catch (err) {
    const duration = Date.now() - startedAt;
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
    await logCrmForwardResult(db, {
      crmForwardId: fwd.id,
      status: isAbort ? 'timeout' : 'failed',
      durationMs: duration,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * LINE 公式の X-Line-Signature を生成する (HMAC-SHA256 → base64)。
 * https://developers.line.biz/en/reference/messaging-api/#signature-validation
 */
async function signLineHmac(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  // base64 (Cloudflare Workers では Buffer 無しなので手動)
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
