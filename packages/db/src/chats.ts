import { jstNow } from './utils.js';
// オペレーター＆チャット管理クエリヘルパー

export interface OperatorRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
  id: string;
  friend_id: string;
  operator_id: string | null;
  status: string;
  notes: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

// --- オペレーター ---

export async function getOperators(db: D1Database): Promise<OperatorRow[]> {
  const result = await db.prepare(`SELECT * FROM operators ORDER BY created_at DESC`).all<OperatorRow>();
  return result.results;
}

export async function getOperatorById(db: D1Database, id: string): Promise<OperatorRow | null> {
  return db.prepare(`SELECT * FROM operators WHERE id = ?`).bind(id).first<OperatorRow>();
}

export async function createOperator(
  db: D1Database,
  input: { name: string; email: string; role?: string },
): Promise<OperatorRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO operators (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.email, input.role ?? 'operator', now, now).run();
  return (await getOperatorById(db, id))!;
}

export async function updateOperator(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; email: string; role: string; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.email !== undefined) { sets.push('email = ?'); values.push(updates.email); }
  if (updates.role !== undefined) { sets.push('role = ?'); values.push(updates.role); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE operators SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteOperator(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM operators WHERE id = ?`).bind(id).run();
}

// --- チャット ---

export async function getChats(db: D1Database, opts: { status?: string; operatorId?: string } = {}): Promise<ChatRow[]> {
  if (opts.status && opts.operatorId) {
    const result = await db.prepare(`SELECT * FROM chats WHERE status = ? AND operator_id = ? ORDER BY last_message_at DESC`)
      .bind(opts.status, opts.operatorId).all<ChatRow>();
    return result.results;
  }
  if (opts.status) {
    const result = await db.prepare(`SELECT * FROM chats WHERE status = ? ORDER BY last_message_at DESC`)
      .bind(opts.status).all<ChatRow>();
    return result.results;
  }
  if (opts.operatorId) {
    const result = await db.prepare(`SELECT * FROM chats WHERE operator_id = ? ORDER BY last_message_at DESC`)
      .bind(opts.operatorId).all<ChatRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM chats ORDER BY last_message_at DESC`).all<ChatRow>();
  return result.results;
}

export async function getChatById(db: D1Database, id: string): Promise<ChatRow | null> {
  return db.prepare(`SELECT * FROM chats WHERE id = ?`).bind(id).first<ChatRow>();
}

export async function getChatByFriendId(db: D1Database, friendId: string): Promise<ChatRow | null> {
  return db.prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`).bind(friendId).first<ChatRow>();
}

export async function createChat(
  db: D1Database,
  input: { friendId: string; operatorId?: string },
): Promise<ChatRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO chats (id, friend_id, operator_id, last_message_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.friendId, input.operatorId ?? null, now, now, now).run();
  return (await getChatById(db, id))!;
}

export async function updateChat(
  db: D1Database,
  id: string,
  updates: Partial<{ operatorId: string | null; status: string; notes: string; lastMessageAt: string }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.operatorId !== undefined) { sets.push('operator_id = ?'); values.push(updates.operatorId); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.notes !== undefined) { sets.push('notes = ?'); values.push(updates.notes); }
  if (updates.lastMessageAt !== undefined) { sets.push('last_message_at = ?'); values.push(updates.lastMessageAt); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

/** 友だちからメッセージ受信時にチャットを作成/更新 */
export async function upsertChatOnMessage(db: D1Database, friendId: string): Promise<ChatRow> {
  const existing = await getChatByFriendId(db, friendId);
  const now = jstNow();
  if (existing) {
    // resolvedだった場合はunreadに戻す
    const newStatus = existing.status === 'resolved' ? 'unread' : existing.status;
    await updateChat(db, existing.id, { status: newStatus, lastMessageAt: now });
    return (await getChatById(db, existing.id))!;
  }
  return createChat(db, { friendId });
}
