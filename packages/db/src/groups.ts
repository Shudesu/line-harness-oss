import { jstNow } from './utils.js';
import type { Tag } from './tags.js';

export interface LineGroup {
  id: string;
  account_id: string | null;
  name: string | null;
  status: 'joined' | 'left';
  message_count: number;
  last_message_at: string | null;
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupTag {
  group_id: string;
  tag_id: string;
  assigned_at: string;
}

export interface LineGroupWithTags extends LineGroup {
  tags: Tag[];
}

export interface ListGroupsOptions {
  /** Return only groups carrying this tag. */
  tagId?: string | null;
  accountId?: string | null;
  status?: 'joined' | 'left' | null;
}

/**
 * Attach tags to an already-selected page of groups.
 * D1 allows 100 binds per query, so chunk the IN list.
 */
async function attachTags(
  db: D1Database,
  groups: LineGroup[],
): Promise<LineGroupWithTags[]> {
  const byGroup = new Map<string, Tag[]>(groups.map((g) => [g.id, []]));
  const ids = [...byGroup.keys()];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const result = await db
      .prepare(
        `SELECT gt.group_id, t.*
           FROM group_tags gt
           INNER JOIN tags t ON t.id = gt.tag_id
          WHERE gt.group_id IN (${chunk.map(() => '?').join(',')})
          ORDER BY t.name ASC`,
      )
      .bind(...chunk)
      .all<Tag & { group_id: string }>();
    for (const { group_id, ...tag } of result.results) {
      byGroup.get(group_id)?.push(tag as Tag);
    }
  }
  return groups.map((g) => ({ ...g, tags: byGroup.get(g.id) ?? [] }));
}

export async function listGroups(
  db: D1Database,
  options: ListGroupsOptions = {},
): Promise<LineGroupWithTags[]> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (options.tagId) {
    where.push(
      `EXISTS (SELECT 1 FROM group_tags gt WHERE gt.group_id = g.id AND gt.tag_id = ?)`,
    );
    binds.push(options.tagId);
  }
  if (options.accountId) {
    where.push(`g.account_id = ?`);
    binds.push(options.accountId);
  }
  if (options.status) {
    where.push(`g.status = ?`);
    binds.push(options.status);
  }

  const result = await db
    .prepare(
      `SELECT g.* FROM line_groups g
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY g.last_message_at IS NULL, g.last_message_at DESC, g.created_at DESC`,
    )
    .bind(...binds)
    .all<LineGroup>();

  return attachTags(db, result.results);
}

export async function getGroupById(
  db: D1Database,
  id: string,
): Promise<LineGroupWithTags | null> {
  const group = await db
    .prepare(`SELECT * FROM line_groups WHERE id = ?`)
    .bind(id)
    .first<LineGroup>();
  if (!group) return null;
  const [withTags] = await attachTags(db, [group]);
  return withTags;
}

export interface UpsertLineGroupInput {
  id: string;
  accountId?: string | null;
  name?: string | null;
  /** Bump message_count and last_message_at (set by the webhook on message events). */
  sawMessageAt?: string | null;
}

/**
 * Register a group the bot was added to, or refresh it on each inbound message.
 *
 * `name` is only overwritten when a non-empty value is supplied — LINE's group
 * summary API is not always reachable, and an occasional null answer must not
 * erase a name we already resolved.
 */
export async function upsertLineGroup(
  db: D1Database,
  input: UpsertLineGroupInput,
): Promise<LineGroup> {
  const now = jstNow();
  const seenAt = input.sawMessageAt ?? null;

  await db
    .prepare(
      `INSERT INTO line_groups
         (id, account_id, name, status, message_count, last_message_at, joined_at, created_at, updated_at)
       VALUES (?, ?, ?, 'joined', ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         account_id      = COALESCE(excluded.account_id, line_groups.account_id),
         name            = COALESCE(NULLIF(excluded.name, ''), line_groups.name),
         status          = 'joined',
         left_at         = NULL,
         message_count   = line_groups.message_count + ?,
         last_message_at = CASE
           WHEN excluded.last_message_at IS NULL THEN line_groups.last_message_at
           WHEN line_groups.last_message_at IS NULL THEN excluded.last_message_at
           ELSE MAX(excluded.last_message_at, line_groups.last_message_at)
         END,
         updated_at      = ?`,
    )
    .bind(
      input.id,
      input.accountId ?? null,
      input.name ?? null,
      seenAt ? 1 : 0,
      seenAt,
      now,
      now,
      now,
      seenAt ? 1 : 0,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM line_groups WHERE id = ?`)
    .bind(input.id)
    .first<LineGroup>())!;
}

/** The bot was removed from the group. Keep the row so its tags and tasks survive. */
export async function markGroupLeft(
  db: D1Database,
  id: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE line_groups SET status = 'left', left_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(now, now, id)
    .run();
}

export async function addTagToGroup(
  db: D1Database,
  groupId: string,
  tagId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO group_tags (group_id, tag_id, assigned_at) VALUES (?, ?, ?)`,
    )
    .bind(groupId, tagId, jstNow())
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function removeTagFromGroup(
  db: D1Database,
  groupId: string,
  tagId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM group_tags WHERE group_id = ? AND tag_id = ?`)
    .bind(groupId, tagId)
    .run();
}

export async function getGroupTags(
  db: D1Database,
  groupId: string,
): Promise<Tag[]> {
  const result = await db
    .prepare(
      `SELECT t.* FROM tags t
         INNER JOIN group_tags gt ON gt.tag_id = t.id
        WHERE gt.group_id = ?
        ORDER BY t.name ASC`,
    )
    .bind(groupId)
    .all<Tag>();
  return result.results;
}
