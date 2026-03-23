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
} from '@line-crm/db';
import type { Env } from '../index.js';

const scoring = new Hono<Env>();

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
