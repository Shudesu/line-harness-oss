import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  cancelMeetConsultation,
  registerMeetConsultation,
  type RegisterMeetConsultationInput,
} from '../services/meet-consultation-reminders.js';

const meetConsultations = new Hono<Env>();

meetConsultations.get('/api/meet-consultations', async (c) => {
  const status = c.req.query('status') ?? 'confirmed';
  if (!['confirmed', 'cancelled', 'completed', 'all'].includes(status)) {
    return c.json({ success: false, error: 'invalid status' }, 400);
  }
  const result = await c.env.DB
    .prepare(
      `SELECT c.id, c.external_event_id, c.friend_id, c.title, c.starts_at, c.ends_at,
              c.meet_url, c.status, c.created_at, c.updated_at,
              f.display_name,
              SUM(CASE WHEN r.status='pending' THEN 1 ELSE 0 END) AS pending_reminders,
              SUM(CASE WHEN r.status='sent' THEN 1 ELSE 0 END) AS sent_reminders,
              SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END) AS failed_reminders
         FROM meet_consultations c
         INNER JOIN friends f ON f.id = c.friend_id
         LEFT JOIN meet_consultation_reminders r ON r.consultation_id = c.id
        WHERE (? = 'all' OR c.status = ?)
        GROUP BY c.id
        ORDER BY c.starts_at ASC`,
    )
    .bind(status, status)
    .all();
  return c.json({ success: true, data: result.results ?? [] });
});

meetConsultations.post('/api/meet-consultations', async (c) => {
  try {
    const body = await c.req.json<RegisterMeetConsultationInput>();
    const registered = await registerMeetConsultation(c.env.DB, body);
    return c.json({ success: true, data: registered }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'friend not found or not following' ? 404 : 400;
    return c.json({ success: false, error: message }, status);
  }
});

meetConsultations.delete('/api/meet-consultations/:externalEventId', async (c) => {
  const cancelled = await cancelMeetConsultation(c.env.DB, c.req.param('externalEventId'));
  if (!cancelled) return c.json({ success: false, error: 'consultation not found' }, 404);
  return c.json({ success: true, data: null });
});

export { meetConsultations };
