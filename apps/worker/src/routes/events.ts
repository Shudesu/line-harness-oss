import { Hono } from 'hono';
import {
  createEventTagRule,
  deleteEventTagRule,
  getEventDefinitions,
  getEventTagRules,
  listUserEvents,
  recordUserEvent,
  type EventDefinition as DbEventDefinition,
  type EventTagRule as DbEventTagRule,
  type UserEvent as DbUserEvent,
  type UserEventSource,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireReservationSession } from './reservations/auth.js';

const events = new Hono<Env>();

function serializeUserEvent(row: DbUserEvent) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    friendId: row.friend_id,
    lineUserId: row.line_user_id,
    eventType: row.event_type,
    eventName: row.event_name,
    eventSource: row.event_source,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    sessionId: row.session_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function serializeDefinition(row: DbEventDefinition) {
  return {
    id: row.id,
    eventType: row.event_type,
    name: row.name,
    category: row.category,
    description: row.description,
    isSystem: row.is_system === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeRule(row: DbEventTagRule) {
  return {
    id: row.id,
    name: row.name,
    eventType: row.event_type,
    conditions: row.conditions,
    action: row.action,
    tagId: row.tag_id,
    priority: row.priority,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

events.get('/api/events', async (c) => {
  try {
    const items = await listUserEvents(c.env.DB, {
      friendId: c.req.query('friendId') ?? null,
      lineAccountId: c.req.query('lineAccountId') ?? null,
      eventType: c.req.query('eventType') ?? null,
      dateFrom: c.req.query('dateFrom') ?? null,
      dateTo: c.req.query('dateTo') ?? null,
      limit: Number(c.req.query('limit') ?? 100),
      offset: Number(c.req.query('offset') ?? 0),
    });
    return c.json({ success: true, data: items.map(serializeUserEvent) });
  } catch (err) {
    console.error('GET /api/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

events.post('/api/events', async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId?: string | null;
      friendId?: string | null;
      lineUserId?: string | null;
      eventType: string;
      eventName?: string | null;
      eventSource?: UserEventSource;
      subjectType?: string | null;
      subjectId?: string | null;
      occurredAt?: string | null;
      sessionId?: string | null;
      requestId?: string | null;
      idempotencyKey?: string | null;
      metadata?: Record<string, unknown> | string | null;
    }>();
    if (!body.eventType) return c.json({ success: false, error: 'eventType is required' }, 400);
    const event = await recordUserEvent(c.env.DB, body);
    return c.json({ success: true, data: serializeUserEvent(event) }, 201);
  } catch (err) {
    console.error('POST /api/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

events.post('/api/public/events', async (c) => {
  try {
    const session = await requireReservationSession(c);
    if (!session) return c.json({ success: false, error: 'Unauthorized' }, 401);

    const body = await c.req.json<{
      eventType: string;
      eventName?: string | null;
      subjectType?: string | null;
      subjectId?: string | null;
      sessionId?: string | null;
      requestId?: string | null;
      idempotencyKey?: string | null;
      metadata?: Record<string, unknown> | string | null;
    }>();
    if (!body.eventType) return c.json({ success: false, error: 'eventType is required' }, 400);
    if (!body.eventType.startsWith('liff.')) {
      return c.json({ success: false, error: 'public events must start with liff.' }, 400);
    }

    const event = await recordUserEvent(c.env.DB, {
      lineAccountId: session.lineAccountId,
      friendId: session.friendId,
      lineUserId: session.lineUserId,
      eventType: body.eventType,
      eventName: body.eventName ?? null,
      eventSource: 'liff',
      subjectType: body.subjectType ?? null,
      subjectId: body.subjectId ?? null,
      sessionId: body.sessionId ?? null,
      requestId: body.requestId ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
      metadata: body.metadata ?? {},
    });
    return c.json({ success: true, data: serializeUserEvent(event) }, 201);
  } catch (err) {
    console.error('POST /api/public/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

events.get('/api/event-definitions', async (c) => {
  try {
    const items = await getEventDefinitions(c.env.DB);
    return c.json({ success: true, data: items.map(serializeDefinition) });
  } catch (err) {
    console.error('GET /api/event-definitions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

events.get('/api/event-tag-rules', async (c) => {
  try {
    const items = await getEventTagRules(c.env.DB);
    return c.json({ success: true, data: items.map(serializeRule) });
  } catch (err) {
    console.error('GET /api/event-tag-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

events.post('/api/event-tag-rules', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      eventType: string;
      conditions?: Record<string, unknown> | string | null;
      action: 'add_tag' | 'remove_tag';
      tagId: string;
      priority?: number;
      isActive?: boolean;
    }>();
    if (!body.name || !body.eventType || !body.action || !body.tagId) {
      return c.json({ success: false, error: 'name, eventType, action and tagId are required' }, 400);
    }
    const rule = await createEventTagRule(c.env.DB, body);
    return c.json({ success: true, data: serializeRule(rule) }, 201);
  } catch (err) {
    console.error('POST /api/event-tag-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

events.delete('/api/event-tag-rules/:id', async (c) => {
  try {
    await deleteEventTagRule(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/event-tag-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { events };
