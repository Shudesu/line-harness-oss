import { jstNow } from './utils.js';
// Webhook IN/OUT クエリヘルパー

export interface IncomingWebhookRow {
  id: string;
  name: string;
  source_type: string;
  secret: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface OutgoingWebhookRow {
  id: string;
  name: string;
  url: string;
  event_types: string; // JSON配列
  secret: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// --- 受信Webhook ---

export async function getIncomingWebhooks(db: D1Database): Promise<IncomingWebhookRow[]> {
  const result = await db.prepare(`SELECT * FROM incoming_webhooks ORDER BY created_at DESC`).all<IncomingWebhookRow>();
  return result.results;
}

export async function getIncomingWebhookById(db: D1Database, id: string): Promise<IncomingWebhookRow | null> {
  return db.prepare(`SELECT * FROM incoming_webhooks WHERE id = ?`).bind(id).first<IncomingWebhookRow>();
}

export async function createIncomingWebhook(
  db: D1Database,
  input: { name: string; sourceType?: string; secret?: string },
): Promise<IncomingWebhookRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(`INSERT INTO incoming_webhooks (id, name, source_type, secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.sourceType ?? 'custom', input.secret ?? null, now, now)
    .run();
  return (await getIncomingWebhookById(db, id))!;
}

export async function updateIncomingWebhook(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; sourceType: string; secret: string; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.sourceType !== undefined) { sets.push('source_type = ?'); values.push(updates.sourceType); }
  if (updates.secret !== undefined) { sets.push('secret = ?'); values.push(updates.secret); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE incoming_webhooks SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteIncomingWebhook(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM incoming_webhooks WHERE id = ?`).bind(id).run();
}

// --- 送信Webhook ---

export async function getOutgoingWebhooks(db: D1Database): Promise<OutgoingWebhookRow[]> {
  const result = await db.prepare(`SELECT * FROM outgoing_webhooks ORDER BY created_at DESC`).all<OutgoingWebhookRow>();
  return result.results;
}

export async function getOutgoingWebhookById(db: D1Database, id: string): Promise<OutgoingWebhookRow | null> {
  return db.prepare(`SELECT * FROM outgoing_webhooks WHERE id = ?`).bind(id).first<OutgoingWebhookRow>();
}

export async function createOutgoingWebhook(
  db: D1Database,
  input: { name: string; url: string; eventTypes: string[]; secret?: string },
): Promise<OutgoingWebhookRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(`INSERT INTO outgoing_webhooks (id, name, url, event_types, secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.url, JSON.stringify(input.eventTypes), input.secret ?? null, now, now)
    .run();
  return (await getOutgoingWebhookById(db, id))!;
}

export async function updateOutgoingWebhook(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; url: string; eventTypes: string[]; secret: string; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.url !== undefined) { sets.push('url = ?'); values.push(updates.url); }
  if (updates.eventTypes !== undefined) { sets.push('event_types = ?'); values.push(JSON.stringify(updates.eventTypes)); }
  if (updates.secret !== undefined) { sets.push('secret = ?'); values.push(updates.secret); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE outgoing_webhooks SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteOutgoingWebhook(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM outgoing_webhooks WHERE id = ?`).bind(id).run();
}

/** 指定イベントタイプに一致するアクティブな送信Webhookを取得 */
export async function getActiveOutgoingWebhooksByEvent(db: D1Database, eventType: string): Promise<OutgoingWebhookRow[]> {
  const all = await db
    .prepare(`SELECT * FROM outgoing_webhooks WHERE is_active = 1`)
    .all<OutgoingWebhookRow>();
  return all.results.filter((w) => {
    const types: string[] = JSON.parse(w.event_types);
    return types.includes(eventType) || types.includes('*');
  });
}
