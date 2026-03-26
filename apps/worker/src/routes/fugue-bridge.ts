import { Hono } from 'hono';
import { verifySignature } from '@line-crm/line-sdk';
import type { WebhookRequestBody, WebhookEvent } from '@line-crm/line-sdk';
import { getLineAccounts } from '@line-crm/db';
import type { Env } from '../index.js';

const fugueBridge = new Hono<Env>();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isFollowEvent(event: WebhookEvent): event is WebhookEvent & {
  type: 'follow';
  source: { type: string; userId?: string };
} {
  return event.type === 'follow';
}

fugueBridge.post('/webhooks/line/fugue-bridge', async (c) => {
  const startedAt = Date.now();
  const receivedAt = new Date().toISOString();
  const rawBody = await c.req.text();
  const signature = c.req.header('X-Line-Signature') ?? '';
  const db = c.env.DB;

  let body: WebhookRequestBody;
  try {
    body = JSON.parse(rawBody) as WebhookRequestBody;
  } catch {
    console.error('Failed to parse FUGUE bridge webhook body');
    return c.json({ status: 'ok' }, 200);
  }

  let channelSecret = c.env.LINE_CHANNEL_SECRET;
  if ((body as WebhookRequestBody & { destination?: string }).destination) {
    const accounts = await getLineAccounts(db);
    for (const account of accounts) {
      if (!account.is_active) continue;
      const isValid = await verifySignature(account.channel_secret, rawBody, signature);
      if (isValid) {
        channelSecret = account.channel_secret;
        break;
      }
    }
  }

  const valid = await verifySignature(channelSecret, rawBody, signature);
  if (!valid) {
    console.error('Invalid LINE signature for FUGUE bridge webhook');
    return c.json({ status: 'ok' }, 200);
  }

  const followEvents = body.events.filter(isFollowEvent);
  if (followEvents.length === 0) {
    return c.json({ status: 'ok' }, 200);
  }

  c.executionCtx.waitUntil(
    (async () => {
      for (const event of followEvents) {
        const userId =
          event.source.type === 'user' ? event.source.userId : undefined;
        if (!userId) continue;

        try {
          const userIdHash = await sha256Hex(userId);
          const processingMs = Date.now() - startedAt;

          await db
            .prepare(
              `INSERT INTO fugue_shadow_events (event_type, user_id_hash, source_type, received_at, processing_ms, phase, mode)
               VALUES (?, ?, ?, ?, ?, 2, 'shadow')`,
            )
            .bind(
              'friend_add',
              userIdHash,
              event.source.type,
              receivedAt,
              processingMs,
            )
            .run();
        } catch (err) {
          console.error('Failed to log FUGUE bridge shadow event:', err);
        }
      }
    })(),
  );

  return c.json({ status: 'ok' }, 200);
});

export { fugueBridge };
