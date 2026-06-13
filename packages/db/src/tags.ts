import { jstNow } from './utils.js';
export interface Tag {
  id: string;
  name: string;
  color: string;
  kind: 'system' | 'custom';
  category: string | null;
  description: string | null;
  is_active: number;
  is_locked: number;
  created_at: string;
  updated_at: string | null;
}

export interface FriendTag {
  friend_id: string;
  tag_id: string;
  assigned_at: string;
  source: 'manual' | 'system' | 'automation' | 'reservation' | 'tracked_link' | 'import' | null;
  source_event_id: string | null;
  expires_at: string | null;
  metadata: string | null;
}

const tagSchemaReady = new WeakSet<D1Database>();

async function ensureTagSchema(db: D1Database): Promise<void> {
  if (tagSchemaReady.has(db)) return;
  await ensureColumns(db, 'tags', [
    ['kind', "TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('system', 'custom'))"],
    ['category', 'TEXT'],
    ['description', 'TEXT'],
    ['is_active', 'INTEGER NOT NULL DEFAULT 1'],
    ['is_locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['updated_at', 'TEXT'],
  ]);
  await ensureColumns(db, 'friend_tags', [
    ['source', "TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'system', 'automation', 'reservation', 'tracked_link', 'import'))"],
    ['source_event_id', 'TEXT'],
    ['expires_at', 'TEXT'],
    ['metadata', 'TEXT'],
  ]);
  tagSchemaReady.add(db);
}

export function resetTagSchemaCacheForTest(db?: D1Database): void {
  if (!db) return;
  tagSchemaReady.delete(db);
}

async function ensureColumns(db: D1Database, tableName: string, columns: Array<[string, string]>): Promise<void> {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  const existing = new Set((result.results ?? []).map((column) => column.name));
  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

export async function getTags(db: D1Database): Promise<Tag[]> {
  await ensureTagSchema(db);
  const result = await db
    .prepare(`SELECT * FROM tags WHERE COALESCE(is_active, 1) = 1 ORDER BY kind DESC, category ASC, name ASC`)
    .all<Tag>();
  return result.results;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  kind?: 'system' | 'custom';
  category?: string | null;
  description?: string | null;
  isLocked?: boolean;
}

export async function createTag(
  db: D1Database,
  input: CreateTagInput,
): Promise<Tag> {
  await ensureTagSchema(db);
  const id = crypto.randomUUID();
  const now = jstNow();
  const color = input.color ?? '#3B82F6';
  const kind = input.kind ?? 'custom';

  await db
    .prepare(
      `INSERT INTO tags (id, name, color, kind, category, description, is_active, is_locked, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(id, input.name, color, kind, input.category ?? null, input.description ?? null, input.isLocked ? 1 : kind === 'system' ? 1 : 0, now, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM tags WHERE id = ?`)
    .bind(id)
    .first<Tag>())!;
}

export async function deleteTag(db: D1Database, id: string): Promise<void> {
  await ensureTagSchema(db);
  const tag = await db.prepare(`SELECT is_locked FROM tags WHERE id = ?`).bind(id).first<{ is_locked: number }>();
  if (tag?.is_locked) throw new Error('system tag cannot be deleted');
  await db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run();
}

export interface AddTagToFriendOptions {
  source?: 'manual' | 'system' | 'automation' | 'reservation' | 'tracked_link' | 'import';
  sourceEventId?: string | null;
  expiresAt?: string | null;
  metadata?: string | null;
}

export async function addTagToFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
  options: AddTagToFriendOptions = {},
): Promise<void> {
  await ensureTagSchema(db);
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at, source, source_event_id, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(friendId, tagId, now, options.source ?? 'manual', options.sourceEventId ?? null, options.expiresAt ?? null, options.metadata ?? null)
    .run();
}

export async function removeTagFromFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  await ensureTagSchema(db);
  await db
    .prepare(
      `DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?`,
    )
    .bind(friendId, tagId)
    .run();
}

export async function getFriendTags(
  db: D1Database,
  friendId: string,
): Promise<Tag[]> {
  await ensureTagSchema(db);
  const result = await db
    .prepare(
      `SELECT t.*
       FROM tags t
       INNER JOIN friend_tags ft ON ft.tag_id = t.id
       WHERE ft.friend_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(friendId)
    .all<Tag>();
  return result.results;
}

import type { Friend } from './friends';

export async function getFriendsByTag(
  db: D1Database,
  tagId: string,
): Promise<Friend[]> {
  await ensureTagSchema(db);
  const result = await db
    .prepare(
      `SELECT f.*
       FROM friends f
       INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE ft.tag_id = ?
       ORDER BY f.created_at DESC`,
    )
    .bind(tagId)
    .all<Friend>();
  return result.results;
}

export const RESERVATION_SYSTEM_TAGS = {
  hasReservation: { name: 'sys:予約あり', color: '#22C55E', category: 'reservation', description: '今後の有効予約が1件以上あります。' },
  confirmedReservation: { name: 'sys:予約確定', color: '#16A34A', category: 'reservation', description: '今後の確定予約が1件以上あります。' },
  pendingReservation: { name: 'sys:予約待ち', color: '#F59E0B', category: 'reservation', description: '今後の仮予約があり、確定予約がありません。' },
  cancelledHistory: { name: 'sys:キャンセル経験あり', color: '#F97316', category: 'reservation', description: '過去にキャンセルした予約があります。' },
  visited: { name: 'sys:来園済み', color: '#3B82F6', category: 'visit', description: '来園履歴があります。' },
  noShowHistory: { name: 'sys:無断キャンセルあり', color: '#EF4444', category: 'risk', description: 'no_show履歴があります。' },
  repeater: { name: 'sys:リピーター', color: '#8B5CF6', category: 'visit', description: '来園完了が2件以上あります。' },
  seasonReservation: { name: 'sys:今季予約あり', color: '#06B6D4', category: 'reservation', description: '今年の有効予約があります。' },
} as const;

export async function ensureReservationSystemTags(db: D1Database): Promise<Record<keyof typeof RESERVATION_SYSTEM_TAGS, Tag>> {
  await ensureTagSchema(db);
  const output = {} as Record<keyof typeof RESERVATION_SYSTEM_TAGS, Tag>;
  for (const [key, spec] of Object.entries(RESERVATION_SYSTEM_TAGS) as Array<[keyof typeof RESERVATION_SYSTEM_TAGS, typeof RESERVATION_SYSTEM_TAGS[keyof typeof RESERVATION_SYSTEM_TAGS]]>) {
    const existing = await db.prepare(`SELECT * FROM tags WHERE name = ?`).bind(spec.name).first<Tag>();
    if (existing) {
      await db
        .prepare(`UPDATE tags SET kind = 'system', category = ?, description = COALESCE(description, ?), is_active = 1, is_locked = 1, updated_at = ? WHERE id = ?`)
        .bind(spec.category, spec.description, jstNow(), existing.id)
        .run();
      output[key] = (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(existing.id).first<Tag>())!;
    } else {
      output[key] = await createTag(db, {
        name: spec.name,
        color: spec.color,
        kind: 'system',
        category: spec.category,
        description: spec.description,
        isLocked: true,
      });
    }
  }
  return output;
}

export async function recomputeReservationSystemTagsForFriend(db: D1Database, friendId: string): Promise<void> {
  await ensureTagSchema(db);
  const friend = await db
    .prepare(`SELECT id, user_id FROM friends WHERE id = ?`)
    .bind(friendId)
    .first<{ id: string; user_id: string | null }>();
  if (!friend) return;

  const tags = await ensureReservationSystemTags(db);
  const managedTagIds = Object.values(tags).map((tag) => tag.id);
  if (managedTagIds.length === 0) return;

  const now = jstNow();
  const currentYear = now.slice(0, 4);
  const where = friend.user_id
    ? `(friend_id = ? OR user_id = ?)`
    : `friend_id = ?`;
  const baseBindings = friend.user_id ? [friend.id, friend.user_id] : [friend.id];

  async function count(extraWhere: string, extraBindings: unknown[] = []): Promise<number> {
    const row = await db
      .prepare(`SELECT COUNT(*) AS count FROM reservations WHERE ${where} AND ${extraWhere}`)
      .bind(...baseBindings, ...extraBindings)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  const active = await count(`status IN ('pending', 'confirmed')`);
  const confirmed = await count(`status = 'confirmed'`);
  const pending = await count(`status = 'pending'`);
  const cancelled = await count(`status = 'cancelled'`);
  const noShow = await count(`status = 'no_show'`);
  const completed = await count(`status = 'completed'`);
  const season = await count(`status IN ('pending', 'confirmed') AND reservation_date >= ? AND reservation_date <= ?`, [`${currentYear}-01-01`, `${currentYear}-12-31`]);
  const visitLikeCount = await countDistinctVisitLikeReservations(db, friend.id, friend.user_id);

  const shouldHave = new Set<string>();
  if (active > 0) shouldHave.add(tags.hasReservation.id);
  if (confirmed > 0) shouldHave.add(tags.confirmedReservation.id);
  if (pending > 0 && confirmed === 0) shouldHave.add(tags.pendingReservation.id);
  if (cancelled > 0) shouldHave.add(tags.cancelledHistory.id);
  if (completed > 0 || visitLikeCount > 0) shouldHave.add(tags.visited.id);
  if (noShow > 0) shouldHave.add(tags.noShowHistory.id);
  if (visitLikeCount >= 2) shouldHave.add(tags.repeater.id);
  if (season > 0) shouldHave.add(tags.seasonReservation.id);

  for (const tagId of managedTagIds) {
    if (shouldHave.has(tagId)) {
      await addTagToFriend(db, friend.id, tagId, { source: 'system', metadata: JSON.stringify({ recomputedAt: now }) });
    } else {
      await removeTagFromFriend(db, friend.id, tagId);
    }
  }
}

async function countDistinctVisitLikeReservations(db: D1Database, friendId: string, userId: string | null): Promise<number> {
  if (!userId) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS count FROM reservations WHERE friend_id = ? AND status = 'completed'`)
      .bind(friendId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT id AS visit_key
         FROM reservations
         WHERE (friend_id = ? OR user_id = ?) AND status = 'completed'
         UNION
         SELECT COALESCE(reservation_id, id) AS visit_key
         FROM visits
         WHERE user_id = ?
       )`,
    )
    .bind(friendId, userId, userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function recomputeReservationSystemTagsForUser(db: D1Database, userId: string): Promise<void> {
  await ensureTagSchema(db);
  const result = await db.prepare(`SELECT id FROM friends WHERE user_id = ?`).bind(userId).all<{ id: string }>();
  for (const friend of result.results ?? []) {
    await recomputeReservationSystemTagsForFriend(db, friend.id);
  }
}
