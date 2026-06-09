import { jstNow } from './utils.js';
export interface Friend {
  id: string;
  line_user_id: string;
  display_name: string | null;
  picture_url: string | null;
  status_message: string | null;
  is_following: number;
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
 * multi-account 正規パス: `(line_user_id, line_account_id)` で friend を引く。
 *
 * migration 070 で friends の UNIQUE が `(line_user_id, line_account_id)` に
 * 変わったため、新規 caller はこちらを使うこと。`lineAccountId` を必ず渡す:
 *
 * - 厳密 match を優先する。同じ user が複数 account を follow しているケースで
 *   別 account の行を誤って返さない。
 * - 厳密 match が無い場合は legacy 行 (`line_account_id IS NULL`) を fallback
 *   として 1 行だけ返す。migration 070 以前のデータ (multi-account 化前) は
 *   line_account_id が NULL のままになっているので、これを救う必要がある。
 *
 * caller 側で account を解決できない (例: 外部 webhook が line_user_id だけを
 * 渡してくる) 場合は `getFriendByLineUserIdLegacy` を使う。
 */
export async function getFriendByLineUserId(
  db: D1Database,
  lineUserId: string,
  lineAccountId: string,
): Promise<Friend | null> {
  // 厳密 match を優先しつつ legacy NULL 行に fallback する。
  // ORDER BY (line_account_id = ?) DESC は match=1 を 0 より前に並べる。
  return db
    .prepare(
      `SELECT * FROM friends
         WHERE line_user_id = ?
           AND (line_account_id = ? OR line_account_id IS NULL)
         ORDER BY (line_account_id = ?) DESC
         LIMIT 1`,
    )
    .bind(lineUserId, lineAccountId, lineAccountId)
    .first<Friend>();
}

/**
 * legacy パス: account を解決できない caller 向けに、line_user_id 単独で
 * friend を 1 行返す。multi-account 環境で同じ user の複数行が存在する場合は
 * 最も古い行を返す (created_at ASC) ことで挙動を安定させる。
 *
 * このヘルパを使っている caller はすべて **将来 cleanup 対象**。account を
 * 解決できるルートが整えば、上の正規 helper に置き換える。
 */
export async function getFriendByLineUserIdLegacy(
  db: D1Database,
  lineUserId: string,
): Promise<Friend | null> {
  return db
    .prepare(
      `SELECT * FROM friends
         WHERE line_user_id = ?
         ORDER BY created_at ASC
         LIMIT 1`,
    )
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
  /**
   * 必須: friend がどの LINE 公式アカウントに紐づくかを示す。
   * - `string`: 厳密に `(line_user_id, lineAccountId)` で upsert する。
   *   migration 070 で UNIQUE (line_user_id, line_account_id) なので、
   *   同 user が別 account で follow している既存行とは衝突しない。
   * - `null`: legacy 行 (line_account_id IS NULL) を upsert する。
   *   外部 webhook 等、account を解決できない caller 用の救済パス。
   */
  lineAccountId: string | null;
  displayName?: string | null;
  pictureUrl?: string | null;
  statusMessage?: string | null;
}

/**
 * multi-account 安全な friend upsert。
 *
 * - `(line_user_id, lineAccountId)` で既存行を引いて UPDATE / INSERT する。
 * - `lineAccountId=null` の場合は legacy 行 (line_account_id IS NULL) を
 *   upsert する。同じ user の別 account 行は触らない。
 *
 * 注意: 旧 upsert は `(line_user_id)` 単独 UNIQUE 前提で「先に find して無ければ
 * INSERT」していた。migration 070 後は UNIQUE が複合キーになっているため、
 * find 句にも line_account_id を含めないと、別 account の既存行を上書きしてしまう
 * (= 旧バグの再来)。
 */
export async function upsertFriend(
  db: D1Database,
  input: UpsertFriendInput,
): Promise<Friend> {
  const now = jstNow();
  const accountId = input.lineAccountId ?? null;

  // 厳密 match を引く。getFriendByLineUserId の fallback (legacy NULL 行) は
  // 別行扱いになるべきなので、ここでは fallback を使わず直接 SQL で WHERE する。
  const existing = await db
    .prepare(
      accountId === null
        ? `SELECT * FROM friends WHERE line_user_id = ? AND line_account_id IS NULL LIMIT 1`
        : `SELECT * FROM friends WHERE line_user_id = ? AND line_account_id = ? LIMIT 1`,
    )
    .bind(...(accountId === null ? [input.lineUserId] : [input.lineUserId, accountId]))
    .first<Friend>();

  if (existing) {
    if (accountId === null) {
      await db
        .prepare(
          `UPDATE friends
             SET display_name = ?,
                 picture_url = ?,
                 status_message = ?,
                 is_following = 1,
                 updated_at = ?
           WHERE line_user_id = ? AND line_account_id IS NULL`,
        )
        .bind(
          'displayName' in input ? (input.displayName ?? null) : existing.display_name,
          'pictureUrl' in input ? (input.pictureUrl ?? null) : existing.picture_url,
          'statusMessage' in input ? (input.statusMessage ?? null) : existing.status_message,
          now,
          input.lineUserId,
        )
        .run();
    } else {
      await db
        .prepare(
          `UPDATE friends
             SET display_name = ?,
                 picture_url = ?,
                 status_message = ?,
                 is_following = 1,
                 updated_at = ?
           WHERE line_user_id = ? AND line_account_id = ?`,
        )
        .bind(
          'displayName' in input ? (input.displayName ?? null) : existing.display_name,
          'pictureUrl' in input ? (input.pictureUrl ?? null) : existing.picture_url,
          'statusMessage' in input ? (input.statusMessage ?? null) : existing.status_message,
          now,
          input.lineUserId,
          accountId,
        )
        .run();
    }

    return (await getFriendById(db, existing.id))!;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO friends (id, line_user_id, line_account_id, display_name, picture_url, status_message, is_following, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.lineUserId,
      accountId,
      input.displayName ?? null,
      input.pictureUrl ?? null,
      input.statusMessage ?? null,
      now,
      now,
    )
    .run();

  return (await getFriendById(db, id))!;
}

/**
 * Codex P1 修正: lineAccountId を必ず受け取り、multi-account 環境で
 * 同一 line_user_id の別 account レコードを誤更新しないようにする。
 * lineAccountId が null の場合は line_account_id IS NULL の行のみ更新 (旧データ互換)。
 */
export async function updateFriendFollowStatus(
  db: D1Database,
  lineUserId: string,
  isFollowing: boolean,
  lineAccountId?: string | null,
): Promise<void> {
  if (lineAccountId === null || lineAccountId === undefined) {
    await db
      .prepare(
        `UPDATE friends
           SET is_following = ?, updated_at = ?
         WHERE line_user_id = ? AND line_account_id IS NULL`,
      )
      .bind(isFollowing ? 1 : 0, jstNow(), lineUserId)
      .run();
    return;
  }
  await db
    .prepare(
      `UPDATE friends
         SET is_following = ?, updated_at = ?
       WHERE line_user_id = ? AND line_account_id = ?`,
    )
    .bind(isFollowing ? 1 : 0, jstNow(), lineUserId, lineAccountId)
    .run();
}

/** Get merged metadata across all friend records sharing the same user_id (UUID). */
export async function getMergedMetadataByUserId(
  db: D1Database,
  userId: string,
): Promise<Record<string, unknown>> {
  const result = await db
    .prepare(`SELECT metadata FROM friends WHERE user_id = ? AND metadata IS NOT NULL AND metadata != '{}'`)
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
