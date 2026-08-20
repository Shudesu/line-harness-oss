import { jstNow } from './utils.js';
export interface Friend {
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  status_message: string | null;
  is_following: number;
  first_followed_at?: string | null;
  current_follow_started_at?: string | null;
  last_followed_at?: string | null;
  last_unfollowed_at?: string | null;
  unfollow_count?: number;
  user_id: string | null;
  line_account_id: string | null;
  metadata: string;
  first_tracked_link_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GetFriendsOptions {
  limit?: number;
  offset?: number;
  tagId?: string;
}

export async function getFriends(
  db: D1Database,
  opts: GetFriendsOptions = {},
): Promise<Friend[]> {
  const { limit = 50, offset = 0, tagId } = opts;

  if (tagId) {
    const result = await db
      .prepare(
        `SELECT f.*
         FROM friends f
         INNER JOIN friend_tags ft ON ft.friend_id = f.id
         WHERE ft.tag_id = ?
         ORDER BY f.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(tagId, limit, offset)
      .all<Friend>();
    return result.results;
  }

  const result = await db
    .prepare(
      `SELECT * FROM friends
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<Friend>();
  return result.results;
}

/**
 * 指定 LINE アカウント内で、指定タグを持ち、現在 friend 状態 (is_following = 1)
 * の友だちの line_user_id 配列を返す。リッチメニューの bulk link 用。
 *
 * - tagId が省略された場合は account 内全員の following を返す
 * - line_user_id は LINE bulk link API の userIds に直接渡す形式 (U... 始まり)
 * - 重複は無いはず (friends.line_user_id は UNIQUE)
 */
export async function getFollowingLineUserIdsByTag(
  db: D1Database,
  accountId: string,
  tagId: string | null,
): Promise<string[]> {
  if (tagId) {
    const result = await db
      .prepare(
        `SELECT DISTINCT f.line_user_id
           FROM friends f
           INNER JOIN friend_tags ft ON ft.friend_id = f.id
          WHERE ft.tag_id = ?
            AND f.line_account_id = ?
            AND f.is_following = 1`,
      )
      .bind(tagId, accountId)
      .all<{ line_user_id: string }>();
    return (result.results ?? []).map((r) => r.line_user_id);
  }
  const result = await db
    .prepare(
      `SELECT line_user_id
         FROM friends
        WHERE line_account_id = ? AND is_following = 1`,
    )
    .bind(accountId)
    .all<{ line_user_id: string }>();
  return (result.results ?? []).map((r) => r.line_user_id);
}

/**
 * アカウントスコープ優先の friend 解決。同一プロバイダー配下の複数アカウント
 * では line_user_id が同一になるため、無指定の先頭一致だと別アカウントの
 * friend 行に吸われて通知アカウントがズレる。指定アカウントの行を優先し、
 * 無ければ従来どおり先頭一致にフォールバックする。
 */
export async function getFriendByLineUserIdForAccount(
  db: D1Database,
  lineUserId: string,
  lineAccountId: string | null,
): Promise<Friend | null> {
  if (lineAccountId) {
    const scoped = await db
      .prepare(`SELECT * FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
      .bind(lineUserId, lineAccountId)
      .first<Friend>();
    if (scoped) return scoped;
  }
  return getFriendByLineUserId(db, lineUserId);
}

export async function getFriendByLineUserId(
  db: D1Database,
  lineUserId: string,
): Promise<Friend | null> {
  return db
    .prepare(`SELECT * FROM friends WHERE line_user_id = ?`)
    .bind(lineUserId)
    .first<Friend>();
}

export async function getFriendById(
  db: D1Database,
  id: string,
): Promise<Friend | null> {
  return db
    .prepare(`SELECT * FROM friends WHERE id = ?`)
    .bind(id)
    .first<Friend>();
}

/**
 * Set friend.first_tracked_link_id ONLY if it is currently NULL.
 * Used to authoritatively pin a friend to the campaign they entered through,
 * without ever overwriting once set. The conditional `WHERE ... IS NULL` clause
 * makes this safe against client-side ref tampering: an existing friend cannot
 * change their attribution by replaying /auth/callback or /api/liff/send-form-link
 * with a different ref.
 */
export async function setFriendFirstTrackedLinkIfNull(
  db: D1Database,
  friendId: string,
  trackedLinkId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE friends
       SET first_tracked_link_id = ?, updated_at = ?
       WHERE id = ? AND first_tracked_link_id IS NULL`,
    )
    .bind(trackedLinkId, now, friendId)
    .run();
}

export interface UpsertFriendInput {
  lineUserId: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  statusMessage?: string | null;
}

export async function upsertFriend(
  db: D1Database,
  input: UpsertFriendInput,
): Promise<Friend> {
  const now = jstNow();
  const existing = await getFriendByLineUserId(db, input.lineUserId);

  if (existing) {
    await db
      .prepare(
        `UPDATE friends
         SET display_name = ?,
             picture_url = ?,
             status_message = ?,
             first_followed_at = COALESCE(first_followed_at, created_at),
             current_follow_started_at = CASE
               WHEN is_following = 0 OR current_follow_started_at IS NULL THEN ?
               ELSE current_follow_started_at
             END,
             last_followed_at = CASE
               WHEN is_following = 0 THEN ?
               ELSE COALESCE(last_followed_at, created_at)
             END,
             is_following = 1,
             updated_at = ?
         WHERE line_user_id = ?`,
      )
      .bind(
        'displayName' in input ? (input.displayName ?? null) : existing.display_name,
        'pictureUrl' in input ? (input.pictureUrl ?? null) : existing.picture_url,
        'statusMessage' in input ? (input.statusMessage ?? null) : existing.status_message,
        now,
        now,
        now,
        input.lineUserId,
      )
      .run();

    return (await getFriendByLineUserId(db, input.lineUserId))!;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO friends
         (id, line_user_id, display_name, picture_url, status_message, is_following,
          first_followed_at, current_follow_started_at, last_followed_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineUserId,
      input.displayName ?? null,
      input.pictureUrl ?? null,
      input.statusMessage ?? null,
      now,
      now,
      now,
      now,
      now,
    )
    .run();

  return (await getFriendById(db, id))!;
}

export async function updateFriendFollowStatus(
  db: D1Database,
  lineUserId: string,
  isFollowing: boolean,
): Promise<void> {
  const now = jstNow();
  if (isFollowing) {
    await db
      .prepare(
        `UPDATE friends
            SET first_followed_at = COALESCE(first_followed_at, created_at),
                current_follow_started_at = CASE
                  WHEN is_following = 0 OR current_follow_started_at IS NULL THEN ?
                  ELSE current_follow_started_at
                END,
                last_followed_at = CASE WHEN is_following = 0 THEN ? ELSE last_followed_at END,
                is_following = 1, updated_at = ?
          WHERE line_user_id = ?`,
      )
      .bind(now, now, now, lineUserId)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE friends
          SET is_following = 0,
              current_follow_started_at = NULL,
              last_unfollowed_at = CASE WHEN is_following = 1 THEN ? ELSE last_unfollowed_at END,
              unfollow_count = unfollow_count + CASE WHEN is_following = 1 THEN 1 ELSE 0 END,
              updated_at = ?
        WHERE line_user_id = ?`,
    )
    .bind(now, now, lineUserId)
    .run();
}

/** Get merged metadata across all friend records sharing the same user_id (UUID). */
export async function getMergedMetadataByUserId(
  db: D1Database,
  userId: string,
): Promise<Record<string, unknown>> {
  const result = await db
    .prepare(
      `SELECT metadata FROM friends
       WHERE user_id = ? AND metadata IS NOT NULL AND metadata != '{}'
       ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<{ metadata: string }>();
  const merged: Record<string, unknown> = {};
  for (const row of result.results) {
    try {
      const meta = JSON.parse(row.metadata);
      for (const [k, v] of Object.entries(meta)) {
        if (v != null && v !== '' && !(merged[k] != null && merged[k] !== '')) {
          merged[k] = v;
        }
      }
    } catch { /* skip invalid JSON */ }
  }
  return merged;
}

export async function getFriendCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM friends`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
