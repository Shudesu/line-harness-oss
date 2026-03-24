import { jstNow } from './utils.js';
// 通知機能クエリヘルパー

export interface NotificationRuleRow {
  id: string;
  name: string;
  event_type: string;
  conditions: string;  // JSON
  channels: string;    // JSON配列
  line_account_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  rule_id: string | null;
  event_type: string;
  title: string;
  body: string;
  channel: string;
  status: string;
  metadata: string | null;
  created_at: string;
}

// --- 通知ルール ---

export async function getNotificationRules(db: D1Database): Promise<NotificationRuleRow[]> {
  const result = await db.prepare(`SELECT * FROM notification_rules ORDER BY created_at DESC`).all<NotificationRuleRow>();
  return result.results;
}

export async function getNotificationRuleById(db: D1Database, id: string): Promise<NotificationRuleRow | null> {
  return db.prepare(`SELECT * FROM notification_rules WHERE id = ?`).bind(id).first<NotificationRuleRow>();
}

export async function createNotificationRule(
  db: D1Database,
  input: { name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] },
): Promise<NotificationRuleRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO notification_rules (id, name, event_type, conditions, channels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.eventType, JSON.stringify(input.conditions ?? {}), JSON.stringify(input.channels ?? ['dashboard']), now, now).run();
  return (await getNotificationRuleById(db, id))!;
}

export async function updateNotificationRule(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; eventType: string; conditions: Record<string, unknown>; channels: string[]; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.conditions !== undefined) { sets.push('conditions = ?'); values.push(JSON.stringify(updates.conditions)); }
  if (updates.channels !== undefined) { sets.push('channels = ?'); values.push(JSON.stringify(updates.channels)); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE notification_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteNotificationRule(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM notification_rules WHERE id = ?`).bind(id).run();
}

// --- 通知 ---

export async function getNotifications(db: D1Database, opts: { status?: string; limit?: number } = {}): Promise<NotificationRow[]> {
  const limit = opts.limit ?? 100;
  if (opts.status) {
    const result = await db.prepare(`SELECT * FROM notifications WHERE status = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(opts.status, limit).all<NotificationRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`)
    .bind(limit).all<NotificationRow>();
  return result.results;
}

export async function createNotification(
  db: D1Database,
  input: { ruleId?: string; eventType: string; title: string; body: string; channel: string; metadata?: string },
): Promise<NotificationRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO notifications (id, rule_id, event_type, title, body, channel, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.ruleId ?? null, input.eventType, input.title, input.body, input.channel, input.metadata ?? null, now).run();
  return (await db.prepare(`SELECT * FROM notifications WHERE id = ?`).bind(id).first<NotificationRow>())!;
}

export async function updateNotificationStatus(db: D1Database, id: string, status: string): Promise<void> {
  await db.prepare(`UPDATE notifications SET status = ? WHERE id = ?`).bind(status, id).run();
}

/** イベントタイプに一致するアクティブな通知ルールを取得 */
export async function getActiveNotificationRulesByEvent(db: D1Database, eventType: string): Promise<NotificationRuleRow[]> {
  const result = await db.prepare(`SELECT * FROM notification_rules WHERE event_type = ? AND is_active = 1`)
    .bind(eventType).all<NotificationRuleRow>();
  return result.results;
}
