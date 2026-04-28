import { jstNow } from './utils.js';
export interface Tag {
  id: string;
  name: string;
  color: string;
  group_id: string | null;
  created_at: string;
}

export interface TagGroup {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface FriendTag {
  friend_id: string;
  tag_id: string;
  assigned_at: string;
}

export async function getTags(db: D1Database): Promise<Tag[]> {
  const result = await db
    .prepare(`SELECT * FROM tags ORDER BY name ASC`)
    .all<Tag>();
  return result.results;
}

export async function getTagGroups(db: D1Database): Promise<TagGroup[]> {
  const result = await db
    .prepare(`SELECT * FROM tag_groups ORDER BY sort_order ASC, name ASC`)
    .all<TagGroup>();
  return result.results;
}

export async function createTagGroup(
  db: D1Database,
  input: { name: string; sortOrder?: number },
): Promise<TagGroup> {
  const id = crypto.randomUUID();
  const sortOrder = input.sortOrder ?? 0;
  await db
    .prepare(`INSERT INTO tag_groups (id, name, sort_order) VALUES (?, ?, ?)`)
    .bind(id, input.name, sortOrder)
    .run();
  return (await db.prepare(`SELECT * FROM tag_groups WHERE id = ?`).bind(id).first<TagGroup>())!;
}

export async function updateTagGroup(
  db: D1Database,
  id: string,
  input: { name?: string; sortOrder?: number },
): Promise<TagGroup | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.name !== undefined) { sets.push('name = ?'); binds.push(input.name); }
  if (input.sortOrder !== undefined) { sets.push('sort_order = ?'); binds.push(input.sortOrder); }
  if (sets.length > 0) {
    binds.push(id);
    await db.prepare(`UPDATE tag_groups SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  }
  return (await db.prepare(`SELECT * FROM tag_groups WHERE id = ?`).bind(id).first<TagGroup>()) ?? null;
}

export async function deleteTagGroup(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tag_groups WHERE id = ?`).bind(id).run();
}

export interface CreateTagInput {
  name: string;
  color?: string;
  groupId?: string | null;
}

export async function createTag(
  db: D1Database,
  input: CreateTagInput,
): Promise<Tag> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const color = input.color ?? '#3B82F6';

  await db
    .prepare(
      `INSERT INTO tags (id, name, color, group_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, color, input.groupId ?? null, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM tags WHERE id = ?`)
    .bind(id)
    .first<Tag>())!;
}

export interface UpdateTagInput {
  name?: string;
  color?: string;
  groupId?: string | null;
}

export async function updateTag(
  db: D1Database,
  id: string,
  input: UpdateTagInput,
): Promise<Tag | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    binds.push(input.name);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    binds.push(input.color);
  }
  if (input.groupId !== undefined) {
    sets.push('group_id = ?');
    binds.push(input.groupId);
  }
  if (sets.length === 0) {
    return (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ?? null;
  }
  binds.push(id);
  await db.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ?? null;
}

export async function deleteTag(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run();
}

export async function addTagToFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, now)
    .run();
}

export async function removeTagFromFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
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
