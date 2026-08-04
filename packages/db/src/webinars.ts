import { jstNow } from './utils.js';

export interface Webinar {
  id: string;
  account_id: string | null;
  title: string;
  slug: string;
  status: 'draft' | 'active' | 'archived';
  video_prefix: string | null;
  duration_seconds: number;
  schedule_json: string;
  cta_json: string | null;
  tag_on_attend: string | null;
  tag_on_cta_click: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebinarComment {
  id: string;
  webinar_id: string;
  at_seconds: number;
  author_name: string;
  body: string;
  created_at: string;
}

export interface WebinarViewer {
  id: string;
  webinar_id: string;
  friend_id: string;
  session_start_at: number;
  joined_at: string;
  last_position_seconds: number;
  cta_clicked_at: string | null;
}

export interface WebinarUserComment {
  id: string;
  webinar_id: string;
  friend_id: string;
  session_start_at: number;
  at_seconds: number;
  body: string;
  created_at: string;
  friend_name?: string | null;
}

export interface WebinarSessionStat {
  session_start_at: number;
  viewers: number;
  avg_watched_seconds: number;
  cta_clicks: number;
}

export interface WebinarCreateInput {
  accountId?: string | null;
  title: string;
  slug: string;
  status?: string;
  videoPrefix?: string | null;
  durationSeconds?: number;
  scheduleJson?: string;
  ctaJson?: string | null;
  tagOnAttend?: string | null;
  tagOnCtaClick?: string | null;
}

export async function getWebinars(db: D1Database): Promise<Webinar[]> {
  const { results } = await db
    .prepare('SELECT * FROM webinars ORDER BY created_at DESC')
    .all<Webinar>();
  return results ?? [];
}

export async function getWebinarById(db: D1Database, id: string): Promise<Webinar | null> {
  return db.prepare('SELECT * FROM webinars WHERE id = ?').bind(id).first<Webinar>();
}

export async function getWebinarBySlug(db: D1Database, slug: string): Promise<Webinar | null> {
  return db.prepare('SELECT * FROM webinars WHERE slug = ?').bind(slug).first<Webinar>();
}

export async function createWebinar(db: D1Database, input: WebinarCreateInput): Promise<Webinar> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO webinars (id, account_id, title, slug, status, video_prefix,
         duration_seconds, schedule_json, cta_json, tag_on_attend, tag_on_cta_click,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.accountId ?? null, input.title, input.slug, input.status ?? 'draft',
      input.videoPrefix ?? null, input.durationSeconds ?? 0, input.scheduleJson ?? '[]',
      input.ctaJson ?? null, input.tagOnAttend ?? null, input.tagOnCtaClick ?? null,
      now, now,
    )
    .run();
  return (await getWebinarById(db, id))!;
}

export async function updateWebinar(
  db: D1Database,
  id: string,
  patch: Partial<WebinarCreateInput>,
): Promise<Webinar | null> {
  const existing = await getWebinarById(db, id);
  if (!existing) return null;
  await db
    .prepare(
      `UPDATE webinars SET account_id = ?, title = ?, slug = ?, status = ?,
         video_prefix = ?, duration_seconds = ?, schedule_json = ?, cta_json = ?,
         tag_on_attend = ?, tag_on_cta_click = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.accountId !== undefined ? patch.accountId : existing.account_id,
      patch.title ?? existing.title,
      patch.slug ?? existing.slug,
      patch.status ?? existing.status,
      patch.videoPrefix !== undefined ? patch.videoPrefix : existing.video_prefix,
      patch.durationSeconds ?? existing.duration_seconds,
      patch.scheduleJson ?? existing.schedule_json,
      patch.ctaJson !== undefined ? patch.ctaJson : existing.cta_json,
      patch.tagOnAttend !== undefined ? patch.tagOnAttend : existing.tag_on_attend,
      patch.tagOnCtaClick !== undefined ? patch.tagOnCtaClick : existing.tag_on_cta_click,
      jstNow(), id,
    )
    .run();
  return getWebinarById(db, id);
}

export async function deleteWebinar(db: D1Database, id: string): Promise<void> {
  // D1 は FK OFF がデフォルトのことがあるので子テーブルも明示削除
  await db.batch([
    db.prepare('DELETE FROM webinar_user_comments WHERE webinar_id = ?').bind(id),
    db.prepare('DELETE FROM webinar_viewers WHERE webinar_id = ?').bind(id),
    db.prepare('DELETE FROM webinar_comments WHERE webinar_id = ?').bind(id),
    db.prepare('DELETE FROM webinars WHERE id = ?').bind(id),
  ]);
}

export async function getWebinarComments(
  db: D1Database,
  webinarId: string,
): Promise<WebinarComment[]> {
  const { results } = await db
    .prepare('SELECT * FROM webinar_comments WHERE webinar_id = ? ORDER BY at_seconds ASC')
    .bind(webinarId)
    .all<WebinarComment>();
  return results ?? [];
}

export async function replaceWebinarComments(
  db: D1Database,
  webinarId: string,
  comments: Array<{ atSeconds: number; authorName: string; body: string }>,
): Promise<number> {
  const now = jstNow();
  const stmts = [
    db.prepare('DELETE FROM webinar_comments WHERE webinar_id = ?').bind(webinarId),
    ...comments.map((cm) =>
      db
        .prepare(
          `INSERT INTO webinar_comments (id, webinar_id, at_seconds, author_name, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), webinarId, cm.atSeconds, cm.authorName, cm.body, now),
    ),
  ];
  await db.batch(stmts);
  return comments.length;
}

export async function upsertWebinarViewer(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<{ firstJoin: boolean }> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .bind(crypto.randomUUID(), webinarId, friendId, sessionStartAt, jstNow())
    .run();
  return { firstJoin: (result.meta?.changes ?? 0) > 0 };
}

export async function updateWebinarViewerPosition(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
  positionSeconds: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webinar_viewers
       SET last_position_seconds = MAX(last_position_seconds, ?)
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(positionSeconds, webinarId, friendId, sessionStartAt)
    .run();
}

export async function recordWebinarCtaClick(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE webinar_viewers
       SET cta_clicked_at = COALESCE(cta_clicked_at, ?)
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(jstNow(), webinarId, friendId, sessionStartAt)
    .run();
}

export async function insertWebinarUserComment(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    atSeconds: number;
    body: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO webinar_user_comments
         (id, webinar_id, friend_id, session_start_at, at_seconds, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), input.webinarId, input.friendId, input.sessionStartAt,
      input.atSeconds, input.body, jstNow(),
    )
    .run();
}

export async function countSessionUserComments(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM webinar_user_comments
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(webinarId, friendId, sessionStartAt)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getWebinarUserComments(
  db: D1Database,
  webinarId: string,
  limit = 200,
): Promise<WebinarUserComment[]> {
  const { results } = await db
    .prepare(
      `SELECT wuc.*, f.display_name AS friend_name
       FROM webinar_user_comments wuc
       LEFT JOIN friends f ON f.id = wuc.friend_id
       WHERE wuc.webinar_id = ?
       ORDER BY wuc.created_at DESC, wuc.id DESC LIMIT ?`,
    )
    .bind(webinarId, limit)
    .all<WebinarUserComment>();
  return results ?? [];
}

export async function getWebinarSessionStats(
  db: D1Database,
  webinarId: string,
): Promise<WebinarSessionStat[]> {
  const { results } = await db
    .prepare(
      `SELECT session_start_at,
              COUNT(*) AS viewers,
              CAST(AVG(last_position_seconds) AS INTEGER) AS avg_watched_seconds,
              SUM(CASE WHEN cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS cta_clicks
       FROM webinar_viewers
       WHERE webinar_id = ?
       GROUP BY session_start_at
       ORDER BY session_start_at DESC`,
    )
    .bind(webinarId)
    .all<WebinarSessionStat>();
  return results ?? [];
}

/** 離脱位置分布: last_position_seconds を10分(600秒)刻みでバケット集計 */
export async function getWebinarDropoff(
  db: D1Database,
  webinarId: string,
): Promise<Array<{ bucket_start: number; viewers: number }>> {
  const { results } = await db
    .prepare(
      `SELECT (last_position_seconds / 600) * 600 AS bucket_start, COUNT(*) AS viewers
       FROM webinar_viewers WHERE webinar_id = ?
       GROUP BY bucket_start ORDER BY bucket_start`,
    )
    .bind(webinarId)
    .all<{ bucket_start: number; viewers: number }>();
  return results ?? [];
}
