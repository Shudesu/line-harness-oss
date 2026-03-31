import { jstNow } from './utils.js';

// --- Types ---

export interface AiReplyConfigRow {
  id: string;
  line_account_id: string | null;
  is_enabled: number;
  ai_model: string;
  system_prompt: string;
  delay_min_minutes: number;
  delay_max_minutes: number;
  max_context_messages: number;
  max_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface AiReplyQueueRow {
  id: string;
  friend_id: string;
  line_account_id: string | null;
  incoming_message: string;
  ai_response: string;
  status: string;
  scheduled_send_at: string;
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
}

// --- Config ---

export async function getAiReplyConfig(
  db: D1Database,
  lineAccountId?: string | null,
): Promise<AiReplyConfigRow | null> {
  if (lineAccountId) {
    const row = await db
      .prepare(`SELECT * FROM ai_reply_config WHERE line_account_id = ?`)
      .bind(lineAccountId)
      .first<AiReplyConfigRow>();
    if (row) return row;
  }
  // Fallback to global config
  return db
    .prepare(`SELECT * FROM ai_reply_config WHERE line_account_id IS NULL`)
    .first<AiReplyConfigRow>();
}

export async function upsertAiReplyConfig(
  db: D1Database,
  config: {
    lineAccountId?: string | null;
    isEnabled?: boolean;
    aiModel?: string;
    systemPrompt?: string;
    delayMinMinutes?: number;
    delayMaxMinutes?: number;
    maxContextMessages?: number;
    maxTokens?: number;
  },
): Promise<AiReplyConfigRow> {
  const now = jstNow();
  const lineAccountId = config.lineAccountId ?? null;

  const existing = lineAccountId
    ? await db.prepare(`SELECT id FROM ai_reply_config WHERE line_account_id = ?`).bind(lineAccountId).first<{ id: string }>()
    : await db.prepare(`SELECT id FROM ai_reply_config WHERE line_account_id IS NULL`).first<{ id: string }>();

  if (existing) {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (config.isEnabled !== undefined) { sets.push('is_enabled = ?'); values.push(config.isEnabled ? 1 : 0); }
    if (config.aiModel !== undefined) { sets.push('ai_model = ?'); values.push(config.aiModel); }
    if (config.systemPrompt !== undefined) { sets.push('system_prompt = ?'); values.push(config.systemPrompt); }
    if (config.delayMinMinutes !== undefined) { sets.push('delay_min_minutes = ?'); values.push(config.delayMinMinutes); }
    if (config.delayMaxMinutes !== undefined) { sets.push('delay_max_minutes = ?'); values.push(config.delayMaxMinutes); }
    if (config.maxContextMessages !== undefined) { sets.push('max_context_messages = ?'); values.push(config.maxContextMessages); }
    if (config.maxTokens !== undefined) { sets.push('max_tokens = ?'); values.push(config.maxTokens); }
    sets.push('updated_at = ?'); values.push(now);
    values.push(existing.id);
    await db.prepare(`UPDATE ai_reply_config SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
    return (await db.prepare(`SELECT * FROM ai_reply_config WHERE id = ?`).bind(existing.id).first<AiReplyConfigRow>())!;
  }

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO ai_reply_config (id, line_account_id, is_enabled, ai_model, system_prompt, delay_min_minutes, delay_max_minutes, max_context_messages, max_tokens, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    lineAccountId,
    config.isEnabled ? 1 : 0,
    config.aiModel ?? 'claude-haiku',
    config.systemPrompt ?? 'あなたは親切なカスタマーサポート担当です。自然な日本語で簡潔に回答してください。',
    config.delayMinMinutes ?? 10,
    config.delayMaxMinutes ?? 30,
    config.maxContextMessages ?? 20,
    config.maxTokens ?? 500,
    now, now,
  ).run();
  return (await db.prepare(`SELECT * FROM ai_reply_config WHERE id = ?`).bind(id).first<AiReplyConfigRow>())!;
}

// --- Queue ---

export async function createAiReplyQueueEntry(
  db: D1Database,
  entry: {
    friendId: string;
    lineAccountId?: string | null;
    incomingMessage: string;
    aiResponse: string;
    scheduledSendAt: string;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO ai_reply_queue (id, friend_id, line_account_id, incoming_message, ai_response, status, scheduled_send_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(id, entry.friendId, entry.lineAccountId ?? null, entry.incomingMessage, entry.aiResponse, entry.scheduledSendAt, jstNow()).run();
}

export async function cancelPendingAiReplies(db: D1Database, friendId: string): Promise<number> {
  const result = await db
    .prepare(`UPDATE ai_reply_queue SET status = 'cancelled' WHERE friend_id = ? AND status = 'pending'`)
    .bind(friendId)
    .run();
  return result.meta.changes ?? 0;
}

export async function getDueAiReplies(db: D1Database, now: string): Promise<(AiReplyQueueRow & { line_user_id: string })[]> {
  const result = await db.prepare(
    `SELECT q.*, f.line_user_id
     FROM ai_reply_queue q
     JOIN friends f ON f.id = q.friend_id
     WHERE q.status = 'pending' AND q.scheduled_send_at <= ?
     ORDER BY q.scheduled_send_at ASC`,
  ).bind(now).all<AiReplyQueueRow & { line_user_id: string }>();
  return result.results;
}

export async function markAiReplySent(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE ai_reply_queue SET status = 'sent', sent_at = ? WHERE id = ?`).bind(jstNow(), id).run();
}

export async function markAiReplyFailed(db: D1Database, id: string, errorMessage: string): Promise<void> {
  await db.prepare(`UPDATE ai_reply_queue SET status = 'failed', error_message = ? WHERE id = ?`).bind(errorMessage, id).run();
}

export async function getAiReplyQueue(
  db: D1Database,
  opts?: { lineAccountId?: string; status?: string; limit?: number },
): Promise<AiReplyQueueRow[]> {
  let sql = 'SELECT * FROM ai_reply_queue WHERE 1=1';
  const binds: unknown[] = [];
  if (opts?.lineAccountId) { sql += ' AND line_account_id = ?'; binds.push(opts.lineAccountId); }
  if (opts?.status) { sql += ' AND status = ?'; binds.push(opts.status); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(opts?.limit ?? 50);
  const result = await db.prepare(sql).bind(...binds).all<AiReplyQueueRow>();
  return result.results;
}
