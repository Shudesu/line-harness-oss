import { jstNow } from './utils.js';
// リマインダ配信クエリヘルパー

export interface ReminderRow {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  /** 'manual' = ユーザー定義カスタム / 'booking' = 予約紐付き自動 */
  trigger_type: 'manual' | 'booking';
  created_at: string;
  updated_at: string;
}

export interface ReminderStepRow {
  id: string;
  reminder_id: string;
  offset_minutes: number;
  message_type: string;
  message_content: string;
  created_at: string;
}

export interface FriendReminderRow {
  id: string;
  friend_id: string;
  reminder_id: string;
  target_date: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// --- リマインダCRUD ---

export async function getReminders(db: D1Database): Promise<ReminderRow[]> {
  const result = await db.prepare(`SELECT * FROM reminders ORDER BY created_at DESC`).all<ReminderRow>();
  return result.results;
}

export async function getReminderById(db: D1Database, id: string): Promise<ReminderRow | null> {
  return db.prepare(`SELECT * FROM reminders WHERE id = ?`).bind(id).first<ReminderRow>();
}

export async function createReminder(
  db: D1Database,
  input: { name: string; description?: string },
): Promise<ReminderRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO reminders (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.description ?? null, now, now).run();
  return (await getReminderById(db, id))!;
}

export async function updateReminder(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; description: string; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteReminder(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM reminders WHERE id = ?`).bind(id).run();
}

// --- リマインダステップ ---

export async function getReminderSteps(db: D1Database, reminderId: string): Promise<ReminderStepRow[]> {
  const result = await db.prepare(`SELECT * FROM reminder_steps WHERE reminder_id = ? ORDER BY offset_minutes ASC`)
    .bind(reminderId).all<ReminderStepRow>();
  return result.results;
}

export async function createReminderStep(
  db: D1Database,
  input: { reminderId: string; offsetMinutes: number; messageType: string; messageContent: string },
): Promise<ReminderStepRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.reminderId, input.offsetMinutes, input.messageType, input.messageContent, now).run();
  return (await db.prepare(`SELECT * FROM reminder_steps WHERE id = ?`).bind(id).first<ReminderStepRow>())!;
}

export async function deleteReminderStep(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM reminder_steps WHERE id = ?`).bind(id).run();
}

// --- 友だちリマインダ ---

export async function enrollFriendInReminder(
  db: D1Database,
  input: { friendId: string; reminderId: string; targetDate: string },
): Promise<FriendReminderRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO friend_reminders (id, friend_id, reminder_id, target_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.friendId, input.reminderId, input.targetDate, now, now).run();
  return (await db.prepare(`SELECT * FROM friend_reminders WHERE id = ?`).bind(id).first<FriendReminderRow>())!;
}

export async function getFriendReminders(db: D1Database, friendId: string): Promise<FriendReminderRow[]> {
  const result = await db.prepare(`SELECT * FROM friend_reminders WHERE friend_id = ? ORDER BY target_date ASC`)
    .bind(friendId).all<FriendReminderRow>();
  return result.results;
}

export async function cancelFriendReminder(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE friend_reminders SET status = 'cancelled', updated_at = ? WHERE id = ?`)
    .bind(jstNow(), id).run();
}

/** リマインダ配信処理用: 配信が必要な友だちリマインダを取得 */
export async function getDueReminderDeliveries(db: D1Database, now: string): Promise<Array<FriendReminderRow & { steps: ReminderStepRow[] }>> {
  // activeなリマインダ登録を取得
  const activeReminders = await db
    .prepare(`SELECT fr.* FROM friend_reminders fr
              INNER JOIN reminders r ON r.id = fr.reminder_id
              WHERE fr.status = 'active' AND r.is_active = 1`)
    .all<FriendReminderRow>();

  const results: Array<FriendReminderRow & { steps: ReminderStepRow[] }> = [];
  for (const fr of activeReminders.results) {
    const steps = await getReminderSteps(db, fr.reminder_id);
    // 配信済みステップを取得
    const delivered = await db
      .prepare(`SELECT reminder_step_id FROM friend_reminder_deliveries WHERE friend_reminder_id = ?`)
      .bind(fr.id)
      .all<{ reminder_step_id: string }>();
    const deliveredIds = new Set(delivered.results.map((d) => d.reminder_step_id));

    // 未配信で配信時刻が到来しているステップをフィルタ
    const dueSteps = steps.filter((step) => {
      if (deliveredIds.has(step.id)) return false;
      const targetTime = new Date(fr.target_date).getTime() + step.offset_minutes * 60_000;
      return targetTime <= new Date(now).getTime();
    });

    if (dueSteps.length > 0) {
      results.push({ ...fr, steps: dueSteps });
    }
  }
  return results;
}

/** 配信済みを記録 */
export async function markReminderStepDelivered(db: D1Database, friendReminderId: string, reminderStepId: string): Promise<void> {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT OR IGNORE INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id) VALUES (?, ?, ?)`)
    .bind(id, friendReminderId, reminderStepId).run();
}

/** 全ステップ配信済みならcompletedにする */
export async function completeReminderIfDone(db: D1Database, friendReminderId: string, reminderId: string): Promise<void> {
  const totalSteps = await db.prepare(`SELECT COUNT(*) as count FROM reminder_steps WHERE reminder_id = ?`)
    .bind(reminderId).first<{ count: number }>();
  const deliveredSteps = await db.prepare(`SELECT COUNT(*) as count FROM friend_reminder_deliveries WHERE friend_reminder_id = ?`)
    .bind(friendReminderId).first<{ count: number }>();

  if (totalSteps && deliveredSteps && deliveredSteps.count >= totalSteps.count) {
    await db.prepare(`UPDATE friend_reminders SET status = 'completed', updated_at = ? WHERE id = ?`)
      .bind(jstNow(), friendReminderId).run();
  }
}
