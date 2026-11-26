import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getFriendByLineUserId } from '@line-crm/db';
import { pushViaHarnessProxy } from '../services/line-proxy-send.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';
import { verifyWebhookSignature } from '../services/webhook-signature.js';

const app = new Hono<Env>();

// Meet Harness calls this when a hearing session completes
app.post('/api/meet-callback', async (c) => {
  const secret = c.env.MEET_CALLBACK_SECRET;
  if (!secret?.trim()) {
    return c.json({ success: false, error: 'Meet callback is not configured' }, 503);
  }
  const rawBody = await c.req.text();
  if (!await verifyWebhookSignature(secret, rawBody, c.req.header('X-Meet-Signature') ?? '')) {
    return c.json({ success: false, error: 'Meet signature verification failed' }, 401);
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
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }

  if (!body || typeof body.line_user_id !== 'string' || !body.line_user_id ||
      !Array.isArray(body.transcripts) ||
      body.transcripts.some((entry) => !entry || typeof entry.transcript !== 'string' ||
        (entry.question_text !== undefined && typeof entry.question_text !== 'string')) ||
      (body.requirements_doc !== undefined && typeof body.requirements_doc !== 'string')) {
    return c.json({ success: false, error: 'Invalid Meet callback' }, 400);
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
    if (!account?.channel_access_token) {
      return c.json({ success: false, error: 'LINE account is not configured' }, 503);
    }
    accessToken = account.channel_access_token;
  }

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
    await pushViaHarnessProxy(
      c.env.WORKER_PUBLIC_URL ?? c.env.WORKER_URL ?? new URL(c.req.url).origin,
      accessToken,
      friend.line_user_id,
      [{ type: 'flex', altText: 'ヒアリング結果', contents: resultFlex }],
      undefined,
      (request) => dispatchLineProxyLocally(request, c.env),
    );
  } catch (e) {
    console.error('Failed to send meet callback message:', e);
  }

  // Save to friend metadata
  try {
    const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
    const updated = {
      ...existing,
      meet_hearing: {
        session_id: body.session_id,
        status: body.status,
        context: body.context,
        transcripts: body.transcripts,
        requirements_doc: body.requirements_doc,
        completed_at: body.completed_at,
      },
    };
    await c.env.DB.prepare('UPDATE friends SET metadata = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(JSON.stringify(updated), friend.id)
      .run();
  } catch (e) {
    console.error('Failed to save meet hearing to metadata:', e);
  }

  return c.json({ success: true });
});

export { app as meetCallback };
