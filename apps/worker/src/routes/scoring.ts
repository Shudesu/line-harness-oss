import { Hono } from 'hono';
import {
  getScoringRules,
  getScoringRuleById,
  createScoringRule,
  updateScoringRule,
  deleteScoringRule,
  getFriendScore,
  getFriendScoreHistory,
  addScore,
  getMileageRules,
  getMileageRuleById,
  createMileageRule,
  updateMileageRule,
  deleteMileageRule,
  getMileageAdminOverview,
  applyMileageRulesForEvent,
} from '@line-crm/db';
import type { MileageRuleRow } from '@line-crm/db';
import type { Env } from '../index.js';

const scoring = new Hono<Env>();

function serializeMileageRule(rule: MileageRuleRow) {
  let conditions: Record<string, unknown> = {};
  if (rule.conditions) {
    try { conditions = JSON.parse(rule.conditions) as Record<string, unknown>; } catch { conditions = {}; }
  }
  return {
    id: rule.id,
    name: rule.name,
    eventType: rule.event_type,
    source: rule.source,
    amount: rule.amount,
    initialStatus: rule.initial_status,
    conditions,
    isActive: Boolean(rule.is_active),
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
  };
}

// ========== マイル管理 ==========

scoring.get('/api/mileage/overview', async (c) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const overview = await getMileageAdminOverview(c.env.DB, {
      accountId: c.req.query('accountId') || null,
      search: c.req.query('search') || '',
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return c.json({ success: true, data: overview });
  } catch (err) {
    console.error('GET /api/mileage/overview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.get('/api/mileage/rules', async (c) => {
  try {
    const rules = await getMileageRules(c.env.DB);
    return c.json({ success: true, data: rules.map(serializeMileageRule) });
  } catch (err) {
    console.error('GET /api/mileage/rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Generic authenticated ingestion point for future Harness products/SNS.
// The request only records an event + queue row; mileage is calculated by cron.
scoring.post('/api/mileage/events', async (c) => {
  try {
    const body = await c.req.json<{
      friendId?: unknown;
      eventType?: unknown;
      source?: unknown;
      sourceEventId?: unknown;
      subjectKey?: unknown;
      metadata?: unknown;
      occurredAt?: unknown;
    }>();
    const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : '';
    const eventType = typeof body.eventType === 'string' ? body.eventType.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const sourceEventId = typeof body.sourceEventId === 'string' ? body.sourceEventId.trim() : '';
    if (!friendId || !eventType || !source || !sourceEventId) {
      return c.json({ success: false, error: 'friendId, eventType, source and sourceEventId are required' }, 400);
    }
    if (friendId.length > 128 || eventType.length > 100 || source.length > 100 || sourceEventId.length > 256) {
      return c.json({ success: false, error: 'one or more fields are too long' }, 400);
    }
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};
    if (JSON.stringify(metadata).length > 4096) {
      return c.json({ success: false, error: 'metadata_too_large' }, 413);
    }
    const result = await applyMileageRulesForEvent(c.env.DB, {
      friendId,
      eventType,
      source,
      sourceEventId,
      subjectKey: typeof body.subjectKey === 'string' ? body.subjectKey.slice(0, 256) : null,
      metadata,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
    return c.json({ success: true, data: { eventId: result.event.id, queued: true } }, 202);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Mileage friend not found:')) {
      return c.json({ success: false, error: 'friend_not_found' }, 404);
    }
    console.error('POST /api/mileage/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.post('/api/mileage/rules', async (c) => {
  try {
    const body = await c.req.json<{
      name?: string;
      eventType?: string;
      source?: string | null;
      amount?: number;
      initialStatus?: 'pending' | 'available';
      conditions?: {
        dailyCapActions?: number;
        uniquePerSubject?: boolean;
        uniquePerSubjectPerDay?: boolean;
        ignoreMultiplier?: boolean;
        beneficiary?: 'actor' | 'referrer';
        uniquePerReferredFriend?: boolean;
        uniquePerReferredFriendPerSubject?: boolean;
      } | null;
    }>();
    if (!body.name?.trim() || !body.eventType?.trim() || !Number.isInteger(body.amount) || (body.amount ?? 0) <= 0) {
      return c.json({ success: false, error: 'name, eventType and a positive integer amount are required' }, 400);
    }
    const rule = await createMileageRule(c.env.DB, {
      name: body.name.trim(),
      eventType: body.eventType.trim(),
      source: body.source ?? null,
      amount: body.amount!,
      initialStatus: body.initialStatus,
      conditions: body.conditions,
    });
    return c.json({ success: true, data: serializeMileageRule(rule) }, 201);
  } catch (err) {
    console.error('POST /api/mileage/rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.put('/api/mileage/rules/:id', async (c) => {
  try {
    const body = await c.req.json<{
      name?: string;
      eventType?: string;
      source?: string | null;
      amount?: number;
      initialStatus?: 'pending' | 'available';
      conditions?: {
        dailyCapActions?: number;
        uniquePerSubject?: boolean;
        uniquePerSubjectPerDay?: boolean;
        ignoreMultiplier?: boolean;
        beneficiary?: 'actor' | 'referrer';
        uniquePerReferredFriend?: boolean;
        uniquePerReferredFriendPerSubject?: boolean;
      } | null;
      isActive?: boolean;
    }>();
    if (body.amount !== undefined && (!Number.isInteger(body.amount) || body.amount <= 0)) {
      return c.json({ success: false, error: 'amount must be a positive integer' }, 400);
    }
    const updated = await updateMileageRule(c.env.DB, c.req.param('id'), body);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeMileageRule(updated) });
  } catch (err) {
    console.error('PUT /api/mileage/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.delete('/api/mileage/rules/:id', async (c) => {
  try {
    const existing = await getMileageRuleById(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteMileageRule(c.env.DB, existing.id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/mileage/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== スコアリングルールCRUD ==========

scoring.get('/api/scoring-rules', async (c) => {
  try {
    const items = await getScoringRules(c.env.DB);
    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        name: r.name,
        eventType: r.event_type,
        scoreValue: r.score_value,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/scoring-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.get('/api/scoring-rules/:id', async (c) => {
  try {
    const item = await getScoringRuleById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: { id: item.id, name: item.name, eventType: item.event_type, scoreValue: item.score_value, isActive: Boolean(item.is_active), createdAt: item.created_at },
    });
  } catch (err) {
    console.error('GET /api/scoring-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.post('/api/scoring-rules', async (c) => {
  try {
    const body = await c.req.json<{ name: string; eventType: string; scoreValue: number }>();
    if (!body.name || !body.eventType || body.scoreValue === undefined) {
      return c.json({ success: false, error: 'name, eventType, scoreValue are required' }, 400);
    }
    const item = await createScoringRule(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, eventType: item.event_type, scoreValue: item.score_value } }, 201);
  } catch (err) {
    console.error('POST /api/scoring-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.put('/api/scoring-rules/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateScoringRule(c.env.DB, id, body);
    const updated = await getScoringRuleById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, eventType: updated.event_type, scoreValue: updated.score_value, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/scoring-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.delete('/api/scoring-rules/:id', async (c) => {
  try {
    await deleteScoringRule(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/scoring-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 友だちスコア ==========

scoring.get('/api/friends/:id/score', async (c) => {
  try {
    const friendId = c.req.param('id');
    const [score, history] = await Promise.all([
      getFriendScore(c.env.DB, friendId),
      getFriendScoreHistory(c.env.DB, friendId),
    ]);
    return c.json({
      success: true,
      data: {
        friendId,
        currentScore: score,
        history: history.map((h) => ({
          id: h.id,
          scoringRuleId: h.scoring_rule_id,
          scoreChange: h.score_change,
          reason: h.reason,
          createdAt: h.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/friends/:id/score error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 手動スコア加算
scoring.post('/api/friends/:id/score', async (c) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{ scoreChange: number; reason?: string }>();
    if (body.scoreChange === undefined) return c.json({ success: false, error: 'scoreChange is required' }, 400);
    await addScore(c.env.DB, { friendId, scoreChange: body.scoreChange, reason: body.reason });
    const newScore = await getFriendScore(c.env.DB, friendId);
    return c.json({ success: true, data: { friendId, currentScore: newScore } }, 201);
  } catch (err) {
    console.error('POST /api/friends/:id/score error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { scoring };
