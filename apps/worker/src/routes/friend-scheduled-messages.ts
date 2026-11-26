import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { Hono, type Context } from 'hono';
import { getFriendById } from '@line-crm/db';
import {
  SCHEDULED_MESSAGE_STATUSES,
  ScheduledMessageValidationError,
  cancelScheduledMessage,
  createScheduledMessage,
  listScheduledMessages,
  listScheduledMessagesForFriend,
  serializeScheduledMessage,
  type ScheduledMessageStatus,
} from '../services/friend-scheduled-messages.js';
import type { Env } from '../index.js';

/**
 * 友だち1人宛ての予約送信 API。認証は他の /api/* と同じ (index.ts の authMiddleware)。
 *
 *   POST   /api/friends/:id/scheduled-messages            { content, sendAt, messageType?, altText?, trackLinks? }
 *   GET    /api/friends/:id/scheduled-messages?status=pending
 *   POST   /api/friends/:id/scheduled-messages/:msgId/cancel
 *   DELETE /api/friends/:id/scheduled-messages/:msgId      (= cancel。行は消さず cancelled にする)
 *   GET    /api/scheduled-messages?status=pending&lineAccountId=&limit=
 */
const friendScheduledMessages = createAuthorizedRouter<Env>();

function staffLabel(c: Context<Env>): string | null {
  const staff = c.get('staff') as { id: string; name: string } | undefined;
  if (!staff) return null;
  return staff.name || staff.id;
}

function parseStatus(raw: string | undefined): ScheduledMessageStatus | undefined | 'invalid' {
  if (!raw) return undefined;
  return (SCHEDULED_MESSAGE_STATUSES as readonly string[]).includes(raw) ? (raw as ScheduledMessageStatus) : 'invalid';
}

friendScheduledMessages.post('/api/friends/:id/scheduled-messages', async (c) => {
  try {
    const friend = await getFriendById(c.env.DB, c.req.param('id'));
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);
    let body: Record<string, unknown>;
    try {
      body = await c.req.json<Record<string, unknown>>();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const row = await createScheduledMessage(c.env.DB, friend, body, {
      now: new Date(),
      createdBy: staffLabel(c),
    });
    return c.json({ success: true, data: serializeScheduledMessage(row) }, 201);
  } catch (err) {
    if (err instanceof ScheduledMessageValidationError) {
      return c.json({ success: false, error: err.message }, 400);
    }
    console.error('POST /api/friends/:id/scheduled-messages error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendScheduledMessages.get('/api/friends/:id/scheduled-messages', async (c) => {
  try {
    const status = parseStatus(c.req.query('status'));
    if (status === 'invalid') return c.json({ success: false, error: 'invalid status' }, 400);
    const rows = await listScheduledMessagesForFriend(c.env.DB, c.req.param('id'), status);
    return c.json({ success: true, data: rows.map(serializeScheduledMessage) });
  } catch (err) {
    console.error('GET /api/friends/:id/scheduled-messages error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

async function handleCancel(c: Context<Env>) {
  try {
    const outcome = await cancelScheduledMessage(
      c.env.DB,
      c.req.param('id') as string,
      c.req.param('msgId') as string,
      staffLabel(c),
    );
    if (outcome === 'not_found') return c.json({ success: false, error: 'Scheduled message not found' }, 404);
    if (outcome === 'not_pending') {
      return c.json({ success: false, error: 'Only pending scheduled messages can be cancelled' }, 409);
    }
    return c.json({ success: true, data: { id: c.req.param('msgId'), status: 'cancelled' } });
  } catch (err) {
    console.error('cancel scheduled message error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
}

friendScheduledMessages.post('/api/friends/:id/scheduled-messages/:msgId/cancel', (c) => handleCancel(c));
friendScheduledMessages.delete('/api/friends/:id/scheduled-messages/:msgId', (c) => handleCancel(c));

friendScheduledMessages.get('/api/scheduled-messages', async (c) => {
  try {
    const status = parseStatus(c.req.query('status'));
    if (status === 'invalid') return c.json({ success: false, error: 'invalid status' }, 400);
    const limitRaw = Number(c.req.query('limit') ?? '100');
    const rows = await listScheduledMessages(c.env.DB, {
      status,
      lineAccountId: c.req.query('lineAccountId') || undefined,
      limit: Number.isFinite(limitRaw) ? limitRaw : 100,
    });
    return c.json({ success: true, data: rows.map(serializeScheduledMessage) });
  } catch (err) {
    console.error('GET /api/scheduled-messages error:', err instanceof Error ? err.message : err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendScheduledMessages };
