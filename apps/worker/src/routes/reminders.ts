import { Hono } from 'hono';
import {
  getReminders,
  getReminderById,
  createReminder,
  updateReminder,
  deleteReminder,
  getReminderSteps,
  createReminderStep,
  deleteReminderStep,
  updateReminderStep,
  enrollFriendInReminder,
  getFriendReminders,
  cancelFriendReminder,
  getReminderEnrollments,
} from '@line-crm/db';
import type { StepTimingType } from '@line-crm/db';
import type { Env } from '../index.js';

const reminders = new Hono<Env>();

// ========== リマインダCRUD ==========

reminders.get('/api/reminders', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let items: Awaited<ReturnType<typeof getReminders>>;
    if (lineAccountId) {
      const result = await c.env.DB
        .prepare(`SELECT * FROM reminders WHERE line_account_id = ? ORDER BY created_at DESC`)
        .bind(lineAccountId)
        .all();
      items = result.results as unknown as Awaited<ReturnType<typeof getReminders>>;
    } else {
      items = await getReminders(c.env.DB);
    }
    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isActive: Boolean(r.is_active),
        eventDate: r.event_date ?? null,
        eventLabel: r.event_label ?? 'イベント日時',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/reminders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const [reminder, steps] = await Promise.all([
      getReminderById(c.env.DB, id),
      getReminderSteps(c.env.DB, id),
    ]);
    if (!reminder) return c.json({ success: false, error: 'Reminder not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: reminder.id,
        name: reminder.name,
        description: reminder.description,
        isActive: Boolean(reminder.is_active),
        eventDate: reminder.event_date ?? null,
        eventLabel: reminder.event_label ?? 'イベント日時',
        createdAt: reminder.created_at,
        updatedAt: reminder.updated_at,
        steps: steps.map((s) => ({
          id: s.id,
          reminderId: s.reminder_id,
          offsetMinutes: s.offset_minutes,
          timingType: s.timing_type ?? 'relative',
          daysOffset: s.days_offset,
          sendHour: s.send_hour,
          sendMinute: s.send_minute,
          messageType: s.message_type,
          messageContent: s.message_content,
          createdAt: s.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.post('/api/reminders', async (c) => {
  try {
    const body = await c.req.json<{
      name: string; description?: string; lineAccountId?: string | null;
      eventDate?: string | null; eventLabel?: string;
    }>();
    if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
    const item = await createReminder(c.env.DB, {
      name: body.name,
      description: body.description,
      eventDate: body.eventDate ?? undefined,
      eventLabel: body.eventLabel,
    });
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE reminders SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, name: item.name, eventDate: item.event_date, createdAt: item.created_at } }, 201);
  } catch (err) {
    console.error('POST /api/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.put('/api/reminders/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateReminder(c.env.DB, id, body);
    const updated = await getReminderById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/reminders/:id', async (c) => {
  try {
    await deleteReminder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== リマインダステップ ==========

reminders.post('/api/reminders/:id/steps', async (c) => {
  try {
    const reminderId = c.req.param('id');
    const body = await c.req.json<{
      offsetMinutes: number;
      messageType: string;
      messageContent: string;
      timingType?: StepTimingType;
      daysOffset?: number | null;
      sendHour?: number | null;
      sendMinute?: number | null;
    }>();
    if (body.offsetMinutes === undefined || !body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'offsetMinutes, messageType, messageContent are required' }, 400);
    }
    const step = await createReminderStep(c.env.DB, {
      reminderId,
      offsetMinutes: body.offsetMinutes,
      messageType: body.messageType,
      messageContent: body.messageContent,
      timingType: body.timingType,
      daysOffset: body.daysOffset,
      sendHour: body.sendHour,
      sendMinute: body.sendMinute,
    });
    return c.json({
      success: true,
      data: {
        id: step.id,
        reminderId: step.reminder_id,
        offsetMinutes: step.offset_minutes,
        timingType: step.timing_type,
        daysOffset: step.days_offset,
        sendHour: step.send_hour,
        sendMinute: step.send_minute,
        messageType: step.message_type,
        createdAt: step.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/reminders/:id/steps error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.put('/api/reminders/:reminderId/steps/:stepId', async (c) => {
  try {
    const stepId = c.req.param('stepId');
    const body = await c.req.json<{
      offsetMinutes?: number;
      messageType?: string;
      messageContent?: string;
      timingType?: StepTimingType;
      daysOffset?: number | null;
      sendHour?: number | null;
      sendMinute?: number | null;
    }>();
    const step = await updateReminderStep(c.env.DB, stepId, body);
    if (!step) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: step.id,
        reminderId: step.reminder_id,
        offsetMinutes: step.offset_minutes,
        timingType: step.timing_type,
        daysOffset: step.days_offset,
        sendHour: step.send_hour,
        sendMinute: step.send_minute,
        messageType: step.message_type,
        messageContent: step.message_content,
        createdAt: step.created_at,
      },
    });
  } catch (err) {
    console.error('PUT /api/reminders/:reminderId/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/reminders/:reminderId/steps/:stepId', async (c) => {
  try {
    await deleteReminderStep(c.env.DB, c.req.param('stepId'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/reminders/:reminderId/steps/:stepId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 友だちリマインダ登録 ==========

reminders.post('/api/reminders/:id/enroll/:friendId', async (c) => {
  try {
    const reminderId = c.req.param('id');
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ targetDate: string }>();
    if (!body.targetDate) return c.json({ success: false, error: 'targetDate is required' }, 400);
    const enrollment = await enrollFriendInReminder(c.env.DB, { friendId, reminderId, targetDate: body.targetDate });
    return c.json({
      success: true,
      data: { id: enrollment.id, friendId: enrollment.friend_id, reminderId: enrollment.reminder_id, targetDate: enrollment.target_date, status: enrollment.status },
    }, 201);
  } catch (err) {
    console.error('POST /api/reminders/:id/enroll/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/reminders/:id/enrollments — リマインダの登録者一覧
reminders.get('/api/reminders/:id/enrollments', async (c) => {
  try {
    const reminderId = c.req.param('id');
    const items = await getReminderEnrollments(c.env.DB, reminderId);
    return c.json({
      success: true,
      data: items.map((e) => ({
        id: e.id,
        friendId: e.friend_id,
        reminderId: e.reminder_id,
        targetDate: e.target_date,
        status: e.status,
        displayName: e.display_name,
        pictureUrl: e.picture_url,
        isFollowing: Boolean(e.is_following),
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/reminders/:id/enrollments error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.get('/api/friends/:friendId/reminders', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const items = await getFriendReminders(c.env.DB, friendId);
    return c.json({
      success: true,
      data: items.map((fr) => ({
        id: fr.id,
        friendId: fr.friend_id,
        reminderId: fr.reminder_id,
        targetDate: fr.target_date,
        status: fr.status,
        createdAt: fr.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/friends/:friendId/reminders error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reminders.delete('/api/friend-reminders/:id', async (c) => {
  try {
    await cancelFriendReminder(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friend-reminders/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { reminders };
