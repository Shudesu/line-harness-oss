import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getFriendByLineUserId } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { resolveAccessToken } from '../lib/account-token.js';

const app = new Hono<Env>();

// P1 緊急修正 (2026-06-07):
//   /api/meet-callback は完全に無認証で任意の line_user_id を受け取って push 送信
//   可能だった。攻撃者が正規 OA から任意 Flex を送信できてフィッシング成立。
//   HMAC-SHA256 署名 + timestamp tolerance + 定時間比較で保護する
//   (Stripe webhook と同じパターン: routes/stripe.ts:verifyStripeSignature)。
const MEET_HMAC_TOLERANCE_SECONDS = 300; // 5 分

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const v = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) return null;
    bytes[i] = v;
  }
  return bytes;
}

async function verifyMeetSignature(
  secret: string,
  rawBody: string,
  sigHeader: string,
): Promise<boolean> {
  // ヘッダ形式: X-Hyhome-Signature: t=<unix秒>,v1=<hex>
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k.trim(), v.join('=').trim()];
    }),
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  // timestamp tolerance: ±5 分以内
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > MEET_HMAC_TOLERANCE_SECONDS) {
    console.warn(`[meet-callback] signature timestamp outside tolerance: ts=${tsNum}, now=${nowSec}`);
    return false;
  }

  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));

  const computedBytes = new Uint8Array(sig);
  const expectedBytes = hexToBytes(expectedSig);
  if (!expectedBytes) return false;
  return constantTimeEqual(computedBytes, expectedBytes);
}

// Meet Harness calls this when a hearing session completes
app.post('/api/meet-callback', async (c) => {
  // P1: secret 未設定なら 503 (安全側に倒す = 認証無しで動作させない)
  const secret = c.env.MEET_CALLBACK_HMAC_SECRET;
  if (!secret) {
    console.error('[meet-callback] MEET_CALLBACK_HMAC_SECRET not configured — refusing to process');
    return c.json(
      { success: false, error: 'meet-callback signing not configured' },
      503,
    );
  }

  // 署名検証 — raw body で HMAC を取らないと改竄検知できないので c.req.text() 経由
  const sigHeader = c.req.header('X-Hyhome-Signature') ?? '';
  if (!sigHeader) {
    return c.json({ success: false, error: 'X-Hyhome-Signature required' }, 401);
  }
  const rawBody = await c.req.text();
  const valid = await verifyMeetSignature(secret, rawBody, sigHeader);
  if (!valid) {
    return c.json({ success: false, error: 'signature verification failed' }, 401);
  }

  let body: {
    session_id: string;
    scenario_id: string;
    line_user_id: string;
    status: string;
    context?: Record<string, unknown>;
    transcripts: Array<{
      question_text?: string;
      transcript: string;
    }>;
    requirements_doc?: string;
    completed_at: string;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ success: false, error: 'invalid JSON body' }, 400);
  }

  if (!body.line_user_id) {
    return c.json({ success: false, error: 'line_user_id required' }, 400);
  }

  const friend = await getFriendByLineUserId(c.env.DB, body.line_user_id);
  if (!friend) {
    return c.json({ success: false, error: 'friend not found' }, 404);
  }

  // Resolve LINE access token (multi-account support)
  let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
  if ((friend as unknown as Record<string, unknown>).line_account_id) {
    const { getLineAccountById } = await import('@line-crm/db');
    const account = await getLineAccountById(c.env.DB, (friend as unknown as Record<string, unknown>).line_account_id as string);
    // Phase 1-G: 暗号化 token を透過的に復号 (緊急血止め 2026-06-07)
    if (account) accessToken = await resolveAccessToken(c.env, account.channel_access_token);
  }
  const lineClient = new LineClient(accessToken);

  // Build Flex message with requirements doc
  const transcriptRows = body.transcripts.map((t) => ({
    type: 'box' as const, layout: 'vertical' as const, margin: 'md' as const,
    contents: [
      { type: 'text' as const, text: t.question_text || 'Q', size: 'xxs' as const, color: '#64748b' },
      { type: 'text' as const, text: t.transcript, size: 'sm' as const, color: '#1e293b', wrap: true },
    ],
  }));

  const resultFlex = {
    type: 'bubble', size: 'giga',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: 'ヒアリング完了', size: 'lg', weight: 'bold', color: '#1e293b' },
        { type: 'text', text: `${friend.display_name || ''}さん`, size: 'xs', color: '#64748b', margin: 'sm' },
      ],
      paddingAll: '20px', backgroundColor: '#f0f9ff',
    },
    body: {
      type: 'box', layout: 'vertical',
      contents: [
        ...transcriptRows,
        { type: 'separator', margin: 'lg' },
        ...(body.requirements_doc ? [
          { type: 'text' as const, text: '要件定義書', size: 'sm' as const, weight: 'bold' as const, color: '#1e293b', margin: 'lg' as const },
          { type: 'text' as const, text: body.requirements_doc.slice(0, 1000), size: 'xs' as const, color: '#334155', wrap: true, margin: 'sm' as const },
        ] : []),
      ],
      paddingAll: '20px',
    },
  };

  try {
    await lineClient.pushMessage(friend.line_user_id, [
      { type: 'flex', altText: 'ヒアリング結果', contents: resultFlex },
    ]);
  } catch (e) {
    console.error('Failed to send meet callback message:', e);
  }

  // Save to friend metadata
  // P1 (2026-06-07): read-modify-write を json_patch で DB 側 atomic merge に置換。
  // 並行 update (例: 同じ friend に対する別系統の metadata write) が消えない。
  try {
    const patch = {
      meet_hearing: {
        session_id: body.session_id,
        status: body.status,
        context: body.context,
        transcripts: body.transcripts,
        requirements_doc: body.requirements_doc,
        completed_at: body.completed_at,
      },
    };
    await c.env.DB.prepare(
      `UPDATE friends
          SET metadata = json_patch(COALESCE(metadata, '{}'), ?),
              updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(JSON.stringify(patch), friend.id)
      .run();
  } catch (e) {
    console.error('Failed to save meet hearing to metadata:', e);
  }

  return c.json({ success: true });
});

export { app as meetCallback };
