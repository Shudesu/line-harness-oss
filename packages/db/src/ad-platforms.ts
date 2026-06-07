import { jstNow } from './utils.js';

export interface AdPlatform {
  id: string;
  name: string;
  display_name: string | null;
  config: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AdPlatformConfig {
  // Meta
  pixel_id?: string;
  access_token?: string;
  test_event_code?: string;
  // X
  api_key?: string;
  api_secret?: string;
  // Google
  customer_id?: string;
  conversion_action_id?: string;
  oauth_token?: string;
  developer_token?: string;
  // TikTok
  pixel_code?: string;
}

export interface AdConversionLog {
  id: string;
  ad_platform_id: string;
  friend_id: string;
  conversion_point_id: string | null;
  event_name: string;
  click_id: string | null;
  click_id_type: string | null;
  status: string;
  request_body: string | null;
  response_body: string | null;
  error_message: string | null;
  created_at: string;
}

export async function getActiveAdPlatforms(db: D1Database): Promise<AdPlatform[]> {
  const result = await db
    .prepare(`SELECT * FROM ad_platforms WHERE is_active = 1`)
    .all<AdPlatform>();
  return result.results;
}

export async function getAdPlatformByName(
  db: D1Database,
  name: string,
): Promise<AdPlatform | null> {
  return db
    .prepare(`SELECT * FROM ad_platforms WHERE name = ? AND is_active = 1`)
    .bind(name)
    .first<AdPlatform>();
}

export async function getAdPlatforms(db: D1Database): Promise<AdPlatform[]> {
  const result = await db
    .prepare(`SELECT * FROM ad_platforms ORDER BY created_at DESC`)
    .all<AdPlatform>();
  return result.results;
}

export async function getAdPlatformById(
  db: D1Database,
  id: string,
): Promise<AdPlatform | null> {
  return db
    .prepare(`SELECT * FROM ad_platforms WHERE id = ?`)
    .bind(id)
    .first<AdPlatform>();
}

export async function createAdPlatform(
  db: D1Database,
  input: { name: string; displayName?: string | null; config: Record<string, unknown> },
): Promise<AdPlatform> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO ad_platforms (id, name, display_name, config, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.name, input.displayName ?? null, JSON.stringify(input.config), now, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM ad_platforms WHERE id = ?`)
    .bind(id)
    .first<AdPlatform>())!;
}

export async function updateAdPlatform(
  db: D1Database,
  id: string,
  input: { name?: string; displayName?: string | null; config?: Record<string, unknown>; isActive?: boolean },
): Promise<AdPlatform | null> {
  const now = jstNow();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.displayName !== undefined) { fields.push('display_name = ?'); values.push(input.displayName); }
  if (input.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(input.config)); }
  if (input.isActive !== undefined) { fields.push('is_active = ?'); values.push(input.isActive ? 1 : 0); }

  values.push(id);

  await db
    .prepare(`UPDATE ad_platforms SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare(`SELECT * FROM ad_platforms WHERE id = ?`).bind(id).first<AdPlatform>();
}

export async function deleteAdPlatform(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM ad_platforms WHERE id = ?`).bind(id).run();
}

/**
 * ad_conversion_logs.status の許容値。
 * - 'sent'           : 正常送信
 * - 'failed'         : 分類不能の失敗 (汎用)
 * - 'failed_client'  : 4xx (P1 追加, retry 不可)
 * - 'failed_server'  : 5xx (P1 追加, retry 可)
 * - 'failed_timeout' : タイムアウト (P1 追加, retry 可)
 * - 'failed_network' : ネットワーク層エラー (P1 追加, retry 可)
 *
 * NOTE: 010_ad_conversions.sql の status カラムには CHECK 制約が無いので
 *       schema 変更なしで追加できる。retry processor は将来追加予定。
 */
export type AdConversionStatus =
  | 'sent'
  | 'failed'
  | 'failed_client'
  | 'failed_server'
  | 'failed_timeout'
  | 'failed_network';

export async function logAdConversion(
  db: D1Database,
  opts: {
    platformId: string;
    friendId: string;
    eventName: string;
    clickId: string;
    clickIdType: string;
    status: AdConversionStatus;
    requestBody?: string | null;
    responseBody?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // Codex指摘 High 冪等性: 054 の partial UNIQUE が status='sent' で効くため、
  // 既送信の (platform, friend, event, click_id) は INSERT OR IGNORE で握り潰す。
  // この helper の直接利用箇所はあらかじめ alreadySent() を見ているが、二重防衛。
  await db
    .prepare(
      `INSERT OR IGNORE INTO ad_conversion_logs
       (id, ad_platform_id, friend_id, event_name, click_id, click_id_type, status, request_body, response_body, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.platformId,
      opts.friendId,
      opts.eventName,
      opts.clickId,
      opts.clickIdType,
      opts.status,
      opts.requestBody ?? null,
      opts.responseBody ?? null,
      opts.errorMessage ?? null,
      now,
    )
    .run();
}

export async function getAdConversionLogs(
  db: D1Database,
  platformId: string,
  limit = 50,
): Promise<AdConversionLog[]> {
  const result = await db
    .prepare(
      `SELECT * FROM ad_conversion_logs WHERE ad_platform_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(platformId, limit)
    .all<AdConversionLog>();
  return result.results;
}

/**
 * L-TRACK 互換: 全プラットフォーム横断のポストバック履歴。
 * UI のポストバック履歴ページで使う。フィルタ可能（status / platform / 期間）。
 */
export async function getAdConversionLogsAll(
  db: D1Database,
  opts: {
    limit?: number;
    status?: 'sent' | 'failed';
    platformName?: string;
    friendId?: string;
    since?: string;
    until?: string;
  } = {},
): Promise<Array<AdConversionLog & { platform_name: string | null; friend_display_name: string | null }>> {
  const limit = Math.min(1000, opts.limit ?? 200);
  const wheres: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) {
    wheres.push('l.status = ?');
    binds.push(opts.status);
  }
  if (opts.platformName) {
    wheres.push('p.name = ?');
    binds.push(opts.platformName);
  }
  if (opts.friendId) {
    wheres.push('l.friend_id = ?');
    binds.push(opts.friendId);
  }
  if (opts.since) {
    wheres.push('l.created_at >= ?');
    binds.push(opts.since);
  }
  if (opts.until) {
    wheres.push('l.created_at <= ?');
    binds.push(opts.until);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  binds.push(limit);
  const result = await db
    .prepare(
      `SELECT l.*, p.name AS platform_name, f.display_name AS friend_display_name
         FROM ad_conversion_logs l
         LEFT JOIN ad_platforms p ON p.id = l.ad_platform_id
         LEFT JOIN friends f ON f.id = l.friend_id
        ${where}
        ORDER BY l.created_at DESC
        LIMIT ?`,
    )
    .bind(...binds)
    .all<AdConversionLog & { platform_name: string | null; friend_display_name: string | null }>();
  return result.results;
}
