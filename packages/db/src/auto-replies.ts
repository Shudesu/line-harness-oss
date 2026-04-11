import { jstNow } from './utils.js';
// =============================================================================
// Auto-Replies — Keyword-triggered automatic responses (L社 自動応答 equivalent)
// =============================================================================

export interface AutoReply {
  id: string;
  keyword: string;
  match_type: 'exact' | 'contains';
  response_type: string;
  response_content: string;
  line_account_id: string | null;
  is_active: number;
  created_at: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getAutoReplies(
  db: D1Database,
  lineAccountId?: string,
): Promise<AutoReply[]> {
  if (lineAccountId) {
    const result = await db
      .prepare(`SELECT * FROM auto_replies WHERE (line_account_id IS NULL OR line_account_id = ?) ORDER BY created_at DESC`)
      .bind(lineAccountId)
      .all<AutoReply>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM auto_replies ORDER BY created_at DESC`)
    .all<AutoReply>();
  return result.results;
}

export async function getAutoReplyById(
  db: D1Database,
  id: string,
): Promise<AutoReply | null> {
  return db
    .prepare(`SELECT * FROM auto_replies WHERE id = ?`)
    .bind(id)
    .first<AutoReply>();
}

export interface CreateAutoReplyInput {
  keyword: string;
  matchType?: 'exact' | 'contains';
  responseType?: string;
  responseContent: string;
  lineAccountId?: string | null;
}

export async function createAutoReply(
  db: D1Database,
  input: CreateAutoReplyInput,
): Promise<AutoReply> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO auto_replies
         (id, keyword, match_type, response_type, response_content,
          line_account_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(
      id,
      input.keyword,
      input.matchType ?? 'exact',
      input.responseType ?? 'text',
      input.responseContent,
      input.lineAccountId ?? null,
      now,
    )
    .run();

  return (await getAutoReplyById(db, id))!;
}

export interface UpdateAutoReplyInput {
  keyword?: string;
  matchType?: 'exact' | 'contains';
  responseType?: string;
  responseContent?: string;
  lineAccountId?: string | null;
  isActive?: boolean;
}

export async function updateAutoReply(
  db: D1Database,
  id: string,
  input: UpdateAutoReplyInput,
): Promise<AutoReply | null> {
  const existing = await getAutoReplyById(db, id);
  if (!existing) return null;

  const now = jstNow();

  await db
    .prepare(
      `UPDATE auto_replies
       SET keyword = ?,
           match_type = ?,
           response_type = ?,
           response_content = ?,
           line_account_id = ?,
           is_active = ?,
           created_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.keyword ?? existing.keyword,
      input.matchType ?? existing.match_type,
      input.responseType ?? existing.response_type,
      input.responseContent ?? existing.response_content,
      'lineAccountId' in input ? (input.lineAccountId ?? null) : existing.line_account_id,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      existing.created_at,
      id,
    )
    .run();

  return getAutoReplyById(db, id);
}

export async function deleteAutoReply(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM auto_replies WHERE id = ?`).bind(id).run();
}
