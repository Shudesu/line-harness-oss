import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  getSegments,
  getSegmentById,
  createSegment,
  updateSegment,
  deleteSegment,
} from '@line-crm/db';
import { buildSegmentCountQuery } from '../services/segment-query.js';
import type { SegmentCondition } from '../services/segment-query.js';

export const segments = new Hono<Env>();

// List segments
segments.get('/api/segments', async (c) => {
  const lineAccountId = c.req.query('lineAccountId');
  const results = await getSegments(c.env.DB, lineAccountId || undefined);
  return c.json({ success: true, data: results });
});

// Get single segment
segments.get('/api/segments/:id', async (c) => {
  const segment = await getSegmentById(c.env.DB, c.req.param('id'));
  if (!segment) return c.json({ success: false, error: 'Not found' }, 404);
  return c.json({ success: true, data: segment });
});

// Create segment
segments.post('/api/segments', async (c) => {
  const body = await c.req.json<{
    name: string;
    description?: string;
    conditionsJson: string;
    lineAccountId?: string;
  }>();
  if (!body.name || !body.conditionsJson) {
    return c.json({ success: false, error: 'name and conditionsJson are required' }, 400);
  }
  // Validate JSON
  try {
    JSON.parse(body.conditionsJson);
  } catch {
    return c.json({ success: false, error: 'conditionsJson must be valid JSON' }, 400);
  }
  const segment = await createSegment(c.env.DB, body);
  return c.json({ success: true, data: segment }, 201);
});

// Update segment
segments.put('/api/segments/:id', async (c) => {
  const body = await c.req.json<{
    name?: string;
    description?: string;
    conditionsJson?: string;
  }>();
  if (body.conditionsJson) {
    try {
      JSON.parse(body.conditionsJson);
    } catch {
      return c.json({ success: false, error: 'conditionsJson must be valid JSON' }, 400);
    }
  }
  const segment = await updateSegment(c.env.DB, c.req.param('id'), body);
  if (!segment) return c.json({ success: false, error: 'Not found' }, 404);
  return c.json({ success: true, data: segment });
});

// Delete segment
segments.delete('/api/segments/:id', async (c) => {
  await deleteSegment(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});

// Preview audience count for given conditions
segments.post('/api/segments/preview', async (c) => {
  const body = await c.req.json<{ conditions: SegmentCondition; lineAccountId?: string }>();
  if (!body.conditions) {
    return c.json({ success: false, error: 'conditions is required' }, 400);
  }
  const { sql, bindings } = buildSegmentCountQuery(body.conditions);
  // Optionally filter by line_account_id
  const finalSql = body.lineAccountId
    ? sql.replace('WHERE ', `WHERE f.line_account_id = '${body.lineAccountId}' AND `)
    : sql;
  const result = await c.env.DB.prepare(finalSql).bind(...bindings).first<{ count: number }>();
  return c.json({ success: true, data: { count: result?.count ?? 0 } });
});
