import { jstNow } from './utils.js';
// アクション自動化 (IF-THEN ルール) クエリヘルパー

export interface AutomationRow {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  conditions: string;  // JSON
  actions: string;     // JSON配列
  line_account_id: string | null;
  is_active: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface AutomationLogRow {
  id: string;
  automation_id: string;
  friend_id: string | null;
  event_data: string | null;
  actions_result: string | null;
  status: string;
  created_at: string;
}

// --- 自動化ルール ---

export async function getAutomations(db: D1Database): Promise<AutomationRow[]> {
  const result = await db.prepare(`SELECT * FROM automations ORDER BY priority DESC, created_at DESC`).all<AutomationRow>();
  return result.results;
}

export async function getAutomationById(db: D1Database, id: string): Promise<AutomationRow | null> {
  return db.prepare(`SELECT * FROM automations WHERE id = ?`).bind(id).first<AutomationRow>();
}

export async function createAutomation(
  db: D1Database,
  input: { name: string; description?: string; eventType: string; conditions?: Record<string, unknown>; actions: unknown[]; priority?: number },
): Promise<AutomationRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO automations (id, name, description, event_type, conditions, actions, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.description ?? null, input.eventType, JSON.stringify(input.conditions ?? {}), JSON.stringify(input.actions), input.priority ?? 0, now, now).run();
  return (await getAutomationById(db, id))!;
}

export async function updateAutomation(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; description: string; eventType: string; conditions: Record<string, unknown>; actions: unknown[]; isActive: boolean; priority: number }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.conditions !== undefined) { sets.push('conditions = ?'); values.push(JSON.stringify(updates.conditions)); }
  if (updates.actions !== undefined) { sets.push('actions = ?'); values.push(JSON.stringify(updates.actions)); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (updates.priority !== undefined) { sets.push('priority = ?'); values.push(updates.priority); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE automations SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteAutomation(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM automations WHERE id = ?`).bind(id).run();
}

// --- 自動化ログ ---

export async function getAutomationLogs(db: D1Database, automationId?: string, limit = 100): Promise<AutomationLogRow[]> {
  if (automationId) {
    const result = await db.prepare(`SELECT * FROM automation_logs WHERE automation_id = ? ORDER BY created_at DESC LIMIT ?`)
      .bind(automationId, limit).all<AutomationLogRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM automation_logs ORDER BY created_at DESC LIMIT ?`)
    .bind(limit).all<AutomationLogRow>();
  return result.results;
}

export async function createAutomationLog(
  db: D1Database,
  input: { automationId: string; friendId?: string; eventData?: string; actionsResult?: string; status: string },
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO automation_logs (id, automation_id, friend_id, event_data, actions_result, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.automationId, input.friendId ?? null, input.eventData ?? null, input.actionsResult ?? null, input.status, now).run();
}

/** イベントタイプに一致するアクティブな自動化ルールを取得（優先度順） */
export async function getActiveAutomationsByEvent(db: D1Database, eventType: string): Promise<AutomationRow[]> {
  const result = await db.prepare(`SELECT * FROM automations WHERE event_type = ? AND is_active = 1 ORDER BY priority DESC`)
    .bind(eventType).all<AutomationRow>();
  return result.results;
}
