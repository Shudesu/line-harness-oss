import { Hono } from 'hono';
import { applyMileageRulesForEvent } from '@line-crm/db';
import type { Env } from '../index.js';

const ALLOWED_EVENTS = new Set([
  'instagram_dm_received',
  'instagram_comment_created',
  'instagram_story_mentioned',
]);

const instagramEngagement = new Hono<Env>();

instagramEngagement.post('/api/integrations/ig-harness/engagement', async (c) => {
  let body: {
    friendId?: unknown;
    eventType?: unknown;
    sourceEventId?: unknown;
    subjectKey?: unknown;
    metadata?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid_json' }, 400);
  }

  const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : '';
  const eventType = typeof body.eventType === 'string' ? body.eventType : '';
  const sourceEventId = typeof body.sourceEventId === 'string' ? body.sourceEventId.trim() : '';
  const subjectKey = typeof body.subjectKey === 'string' ? body.subjectKey.slice(0, 256) : null;
  const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, unknown>
    : {};

  if (!friendId || friendId.length > 128 || !sourceEventId || sourceEventId.length > 256) {
    return c.json({ success: false, error: 'invalid_identity' }, 422);
  }
  if (!ALLOWED_EVENTS.has(eventType)) {
    return c.json({ success: false, error: 'invalid_event_type' }, 422);
  }
  if (JSON.stringify(metadata).length > 4096) {
    return c.json({ success: false, error: 'metadata_too_large' }, 413);
  }

  try {
    const result = await applyMileageRulesForEvent(c.env.DB, {
      eventType,
      source: 'instagram',
      sourceEventId,
      friendId,
      subjectKey,
      metadata,
    });
    return c.json({ success: true, data: { eventId: result.event.id, queued: true } }, 202);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Mileage friend not found:')) {
      return c.json({ success: false, error: 'friend_not_found' }, 404);
    }
    console.error('IG Harness engagement mileage failed:', error);
    return c.json({ success: false, error: 'internal_error' }, 500);
  }
});

export { instagramEngagement };
