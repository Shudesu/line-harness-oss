import { Hono } from 'hono';
import {
  getSurveys,
  getSurveyById,
  createSurvey,
  updateSurvey,
  deleteSurvey,
  submitSurveyResponse,
  getSurveyResponses,
  getSurveyStats,
} from '@line-crm/db';
import type { Env } from '../index.js';

const surveys = new Hono<Env>();

// GET /api/surveys
surveys.get('/api/surveys', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const data = await getSurveys(c.env.DB, lineAccountId);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/surveys/:id
surveys.get('/api/surveys/:id', async (c) => {
  try {
    const data = await getSurveyById(c.env.DB, c.req.param('id'));
    if (!data) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/surveys
surveys.post('/api/surveys', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      questionsJson: string;
      lineAccountId?: string;
    }>();
    if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
    const data = await createSurvey(c.env.DB, body);
    return c.json({ success: true, data }, 201);
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// PUT /api/surveys/:id
surveys.put('/api/surveys/:id', async (c) => {
  try {
    const body = await c.req.json();
    const data = await updateSurvey(c.env.DB, c.req.param('id'), body);
    if (!data) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// DELETE /api/surveys/:id
surveys.delete('/api/surveys/:id', async (c) => {
  try {
    await deleteSurvey(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/surveys/:id/respond — submit a response
surveys.post('/api/surveys/:id/respond', async (c) => {
  try {
    const body = await c.req.json<{ friendId?: string; answersJson: string }>();
    if (!body.answersJson) return c.json({ success: false, error: 'answersJson is required' }, 400);
    const survey = await getSurveyById(c.env.DB, c.req.param('id'));
    if (!survey || !survey.is_active) return c.json({ success: false, error: 'Survey not found or inactive' }, 404);
    const data = await submitSurveyResponse(c.env.DB, c.req.param('id'), body.friendId || null, body.answersJson);
    return c.json({ success: true, data }, 201);
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/surveys/:id/responses
surveys.get('/api/surveys/:id/responses', async (c) => {
  try {
    const data = await getSurveyResponses(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/surveys/:id/stats
surveys.get('/api/surveys/:id/stats', async (c) => {
  try {
    const data = await getSurveyStats(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export { surveys };
