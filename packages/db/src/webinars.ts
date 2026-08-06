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
  picture_url?: string | null;
}

export interface WebinarSessionStat {
  session_start_at: number;
  viewers: number;
  avg_watched_seconds: number;
  cta_clicks: number;
}

export interface WebinarParticipantStat {
  friend_id: string;
  friend_name: string | null;
  picture_url: string | null;
  sessions: number;
  first_joined_at: string;
  latest_joined_at: string;
  max_watched_seconds: number;
  cta_clicked_at: string | null;
  registered: number;
  form_submitted_at: string | null;
}

export interface WebinarDailyStat {
  stat_date: string;
  reservations: number;
  viewers: number;
  cta_clicks: number;
  form_submissions: number;
}

export interface WebinarAnalyticsSummaryRow {
  reservations: number;
  viewers: number;
  registered_and_joined: number;
  watched_5m: number;
  watched_15m: number;
  completed: number;
  avg_watched_seconds: number;
  cta_clicks: number;
  form_submissions: number;
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
    db.prepare('DELETE FROM webinar_ctas WHERE webinar_id = ?').bind(id),
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
              , f.picture_url
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

/** 参加者を friend 単位にまとめる。再入場・複数セッションは1人として表示する。 */
export async function getWebinarParticipantStats(
  db: D1Database,
  webinarId: string,
  limit = 200,
): Promise<WebinarParticipantStat[]> {
  const { results } = await db
    .prepare(
      `SELECT v.friend_id,
              f.display_name AS friend_name,
              f.picture_url,
              COUNT(*) AS sessions,
              MIN(v.joined_at) AS first_joined_at,
              MAX(v.joined_at) AS latest_joined_at,
              MAX(v.last_position_seconds) AS max_watched_seconds,
              MAX(v.cta_clicked_at) AS cta_clicked_at,
              CASE WHEN EXISTS (
                SELECT 1 FROM webinar_registrations r
                WHERE r.webinar_id = v.webinar_id AND r.friend_id = v.friend_id
              ) THEN 1 ELSE 0 END AS registered,
              (
                SELECT MAX(fs.created_at)
                FROM form_submissions fs
                JOIN webinar_ctas wc ON wc.form_id = fs.form_id
                JOIN webinars wf ON wf.id = wc.webinar_id
                WHERE wc.webinar_id = v.webinar_id
                  AND fs.friend_id = v.friend_id
                  AND fs.created_at >= wf.created_at
              ) AS form_submitted_at
       FROM webinar_viewers v
       LEFT JOIN friends f ON f.id = v.friend_id
       WHERE v.webinar_id = ?
       GROUP BY v.webinar_id, v.friend_id, f.display_name, f.picture_url
       ORDER BY latest_joined_at DESC
       LIMIT ?`,
    )
    .bind(webinarId, limit)
    .all<WebinarParticipantStat>();
  return results ?? [];
}

/** KPI は全参加者で集計し、顔写真付き一覧の表示件数に左右されないようにする。 */
export async function getWebinarAnalyticsSummary(
  db: D1Database,
  webinarId: string,
  completionThresholdSeconds: number,
): Promise<WebinarAnalyticsSummaryRow> {
  const row = await db
    .prepare(
      `WITH viewer_rollup AS (
         SELECT friend_id,
                MAX(last_position_seconds) AS max_watched_seconds,
                MAX(CASE WHEN cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked
         FROM webinar_viewers WHERE webinar_id = ? GROUP BY friend_id
       ), form_submitters AS (
         SELECT DISTINCT fs.friend_id
         FROM form_submissions fs
         JOIN webinar_ctas wc ON wc.form_id = fs.form_id
         JOIN webinars w ON w.id = wc.webinar_id
         WHERE wc.webinar_id = ? AND fs.created_at >= w.created_at
       )
       SELECT
         (SELECT COUNT(DISTINCT friend_id) FROM webinar_registrations
          WHERE webinar_id = ?) AS reservations,
         COUNT(*) AS viewers,
         COALESCE(SUM(CASE WHEN EXISTS (
           SELECT 1 FROM webinar_registrations r
           WHERE r.webinar_id = ? AND r.friend_id = vr.friend_id
         ) THEN 1 ELSE 0 END), 0) AS registered_and_joined,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= 300 THEN 1 ELSE 0 END), 0) AS watched_5m,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= 900 THEN 1 ELSE 0 END), 0) AS watched_15m,
         COALESCE(SUM(CASE WHEN vr.max_watched_seconds >= ? THEN 1 ELSE 0 END), 0) AS completed,
         COALESCE(CAST(AVG(vr.max_watched_seconds) AS INTEGER), 0) AS avg_watched_seconds,
         COALESCE(SUM(vr.clicked), 0) AS cta_clicks,
         COALESCE(SUM(CASE WHEN fs.friend_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS form_submissions
       FROM viewer_rollup vr
       LEFT JOIN form_submitters fs ON fs.friend_id = vr.friend_id`,
    )
    .bind(
      webinarId,
      webinarId,
      webinarId,
      webinarId,
      completionThresholdSeconds,
    )
    .first<WebinarAnalyticsSummaryRow>();
  return row ?? {
    reservations: 0,
    viewers: 0,
    registered_and_joined: 0,
    watched_5m: 0,
    watched_15m: 0,
    completed: 0,
    avg_watched_seconds: 0,
    cta_clicks: 0,
    form_submissions: 0,
  };
}

/** 日別の予約→参加→CTA→フォーム推移。日本時間の保存文字列を日付で集計する。 */
export async function getWebinarDailyStats(
  db: D1Database,
  webinarId: string,
): Promise<WebinarDailyStat[]> {
  const { results } = await db
    .prepare(
      `WITH regs AS (
         SELECT friend_id, created_at FROM webinar_registrations WHERE webinar_id = ?
       ), views AS (
         SELECT friend_id, joined_at, cta_clicked_at FROM webinar_viewers WHERE webinar_id = ?
       ), submissions AS (
         SELECT fs.friend_id, fs.created_at
         FROM form_submissions fs
         JOIN webinar_ctas wc ON wc.form_id = fs.form_id
         JOIN webinars w ON w.id = wc.webinar_id
         WHERE wc.webinar_id = ? AND fs.created_at >= w.created_at
       ), dates AS (
         SELECT substr(created_at, 1, 10) AS stat_date FROM regs
         UNION SELECT substr(joined_at, 1, 10) FROM views
         UNION SELECT substr(cta_clicked_at, 1, 10) FROM views WHERE cta_clicked_at IS NOT NULL
         UNION SELECT substr(created_at, 1, 10) FROM submissions
       )
       SELECT d.stat_date,
              (SELECT COUNT(DISTINCT friend_id) FROM regs
               WHERE substr(created_at, 1, 10) = d.stat_date) AS reservations,
              (SELECT COUNT(DISTINCT friend_id) FROM views
               WHERE substr(joined_at, 1, 10) = d.stat_date) AS viewers,
              (SELECT COUNT(DISTINCT friend_id) FROM views
               WHERE substr(cta_clicked_at, 1, 10) = d.stat_date) AS cta_clicks,
              (SELECT COUNT(DISTINCT friend_id) FROM submissions
               WHERE substr(created_at, 1, 10) = d.stat_date) AS form_submissions
       FROM dates d
       WHERE d.stat_date IS NOT NULL AND d.stat_date <> ''
       ORDER BY d.stat_date ASC`,
    )
    .bind(webinarId, webinarId, webinarId)
    .all<WebinarDailyStat>();
  return results ?? [];
}

// ─── Webinar CTA cards ───────────────────────────────────

export interface WebinarCta {
  id: string;
  webinar_id: string;
  at_seconds: number;
  kind: 'form' | 'url';
  title: string;
  body: string | null;
  button_label: string;
  auto_open: number;
  form_id: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
}

export async function getWebinarCtas(
  db: D1Database,
  webinarId: string,
): Promise<WebinarCta[]> {
  const { results } = await db
    .prepare('SELECT * FROM webinar_ctas WHERE webinar_id = ? ORDER BY at_seconds ASC')
    .bind(webinarId)
    .all<WebinarCta>();
  return results ?? [];
}

export async function replaceWebinarCtas(
  db: D1Database,
  webinarId: string,
  ctas: Array<{
    atSeconds: number;
    kind: 'form' | 'url';
    title: string;
    body: string | null;
    buttonLabel: string;
    autoOpen: boolean;
    formId: string | null;
    url: string | null;
  }>,
): Promise<number> {
  const now = jstNow();
  const stmts = [
    db.prepare('DELETE FROM webinar_ctas WHERE webinar_id = ?').bind(webinarId),
    ...ctas.map((cta) =>
      db
        .prepare(
          `INSERT INTO webinar_ctas
             (id, webinar_id, at_seconds, kind, title, body, button_label, auto_open,
              form_id, url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(), webinarId, cta.atSeconds, cta.kind, cta.title, cta.body,
          cta.buttonLabel, cta.autoOpen ? 1 : 0, cta.formId, cta.url, now, now,
        ),
    ),
  ];
  await db.batch(stmts);
  return ctas.length;
}

// ---- セッション予約 (webinar_registrations) ----

export interface WebinarRegistration {
  id: string;
  webinar_id: string;
  friend_id: string;
  session_start_at: number;
  notified_at: string | null;
  created_at: string;
}

/** 予約を upsert する (同一 friend×セッションは冪等) */
export async function upsertWebinarRegistration(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO webinar_registrations
         (id, webinar_id, friend_id, session_start_at, notified_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    )
    .bind(crypto.randomUUID(), webinarId, friendId, sessionStartAt, jstNow())
    .run();
}

/** friend の未来セッション予約 (直近1件) */
export async function getUpcomingWebinarRegistration(
  db: D1Database,
  webinarId: string,
  friendId: string,
  nowEpochSeconds: number,
): Promise<WebinarRegistration | null> {
  return db
    .prepare(
      `SELECT * FROM webinar_registrations
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at > ?
       ORDER BY session_start_at ASC LIMIT 1`,
    )
    .bind(webinarId, friendId, nowEpochSeconds)
    .first<WebinarRegistration>();
}

/** 特定セッションへの予約行 (ライブ中の本人入場判定用) */
export async function getWebinarRegistration(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
): Promise<WebinarRegistration | null> {
  return db
    .prepare(
      `SELECT * FROM webinar_registrations
       WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
    )
    .bind(webinarId, friendId, sessionStartAt)
    .first<WebinarRegistration>();
}

/** 開始 leadSeconds 前〜開始後 (セッション継続中) の未通知予約 */
export async function getDueWebinarRegistrations(
  db: D1Database,
  nowEpochSeconds: number,
  leadSeconds: number,
  limit = 100,
): Promise<Array<WebinarRegistration & { slug: string; title: string; account_id: string | null; duration_seconds: number }>> {
  const { results } = await db
    .prepare(
      `SELECT r.*, w.slug, w.title, w.account_id, w.duration_seconds
       FROM webinar_registrations r
       JOIN webinars w ON w.id = r.webinar_id
       WHERE r.notified_at IS NULL
         AND w.status = 'active'
         AND r.session_start_at <= ?
         AND r.session_start_at + w.duration_seconds > ?
       ORDER BY r.session_start_at ASC
       LIMIT ?`,
    )
    .bind(nowEpochSeconds + leadSeconds, nowEpochSeconds, limit)
    .all<WebinarRegistration & { slug: string; title: string; account_id: string | null; duration_seconds: number }>();
  return results ?? [];
}

/** 通知済みマーク。未通知の場合のみ更新し、更新できたら true (二重送信ガード) */
export async function markWebinarRegistrationNotified(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE webinar_registrations SET notified_at = ? WHERE id = ? AND notified_at IS NULL`,
    )
    .bind(jstNow(), id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
