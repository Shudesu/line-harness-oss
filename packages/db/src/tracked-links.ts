import { jstNow, toJstString } from './utils.js';
// =============================================================================
// Tracked Links — URL click tracking with automatic actions
// =============================================================================

export interface TrackedLink {
  id: string;
  name: string;
  original_url: string;
  tag_id: string | null;
  scenario_id: string | null;
  intro_template_id: string | null;
  reward_template_id: string | null;
  is_active: number;
  click_count: number;
  // 047_skip_liff.sql: L-TRACK 認証スキップモード
  skip_liff: number;
  // 048_media_name.sql: L-TRACK のメディア（媒体）
  media_name: string | null;
  // 049_af_amount.sql: L-TRACK のAF単価（円）
  af_amount: number | null;
  // 050_af_confirm_type.sql: L-TRACK のAF確定条件 'immediate'|'1h'|'3h'|'24h'
  af_confirm_type: string;
  // 052_tracked_links_account.sql: multi-account 境界
  line_account_id: string | null;
  // 042_tracked_links_og.sql: OGP overrides
  og_title: string | null;
  og_description: string | null;
  og_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface LinkClick {
  id: string;
  tracked_link_id: string;
  friend_id: string | null;
  clicked_at: string;
  // 051_link_clicks_attribution.sql: アトリビューション情報
  ltp: string | null;
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  twclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  user_agent: string | null;
  ip_address: string | null;
  ua_fingerprint: string | null;
  matched_at: string | null;
  match_confidence: number | null;
  match_strategy: string | null;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getTrackedLinks(db: D1Database): Promise<TrackedLink[]> {
  const result = await db
    .prepare(`SELECT * FROM tracked_links ORDER BY created_at DESC`)
    .all<TrackedLink>();
  return result.results;
}

export async function getTrackedLinkById(
  db: D1Database,
  id: string,
): Promise<TrackedLink | null> {
  return db
    .prepare(`SELECT * FROM tracked_links WHERE id = ?`)
    .bind(id)
    .first<TrackedLink>();
}

export interface CreateTrackedLinkInput {
  name: string;
  originalUrl: string;
  tagId?: string | null;
  scenarioId?: string | null;
  introTemplateId?: string | null;
  rewardTemplateId?: string | null;
  // L-TRACK 互換フィールド
  skipLiff?: boolean;
  mediaName?: string | null;
  afAmount?: number | null;
  afConfirmType?: 'immediate' | '1h' | '3h' | '24h';
  lineAccountId?: string | null;
}

export const AF_CONFIRM_TYPES = ['immediate', '1h', '3h', '24h'] as const;
export type AfConfirmType = (typeof AF_CONFIRM_TYPES)[number];

export function isAfConfirmType(value: unknown): value is AfConfirmType {
  return typeof value === 'string' && (AF_CONFIRM_TYPES as readonly string[]).includes(value);
}

export async function createTrackedLink(
  db: D1Database,
  input: CreateTrackedLinkInput,
): Promise<TrackedLink> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // Medium fix: af_confirm_type の runtime validation
  const afConfirmType = input.afConfirmType ?? 'immediate';
  if (!isAfConfirmType(afConfirmType)) {
    throw new Error(`Invalid afConfirmType: ${afConfirmType}. Must be one of ${AF_CONFIRM_TYPES.join(', ')}.`);
  }

  await db
    .prepare(
      `INSERT INTO tracked_links (
         id, name, original_url, tag_id, scenario_id,
         intro_template_id, reward_template_id, is_active, click_count,
         skip_liff, media_name, af_amount, af_confirm_type, line_account_id,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.originalUrl,
      input.tagId ?? null,
      input.scenarioId ?? null,
      input.introTemplateId ?? null,
      input.rewardTemplateId ?? null,
      input.skipLiff ? 1 : 0,
      input.mediaName ?? null,
      input.afAmount ?? null,
      afConfirmType,
      input.lineAccountId ?? null,
      now,
      now,
    )
    .run();

  return (await getTrackedLinkById(db, id))!;
}

export interface UpdateTrackedLinkInput {
  name?: string;
  tagId?: string | null;
  scenarioId?: string | null;
  introTemplateId?: string | null;
  rewardTemplateId?: string | null;
  isActive?: boolean;
  // L-TRACK 互換フィールド
  skipLiff?: boolean;
  mediaName?: string | null;
  afAmount?: number | null;
  afConfirmType?: AfConfirmType;
  lineAccountId?: string | null;
}

export async function updateTrackedLink(
  db: D1Database,
  id: string,
  input: UpdateTrackedLinkInput,
): Promise<TrackedLink | null> {
  const existing = await getTrackedLinkById(db, id);
  if (!existing) return null;

  const now = jstNow();
  const name = input.name ?? existing.name;
  const tagId = input.tagId === undefined ? existing.tag_id : input.tagId;
  const scenarioId = input.scenarioId === undefined ? existing.scenario_id : input.scenarioId;
  const introTemplateId =
    input.introTemplateId === undefined ? existing.intro_template_id : input.introTemplateId;
  const rewardTemplateId =
    input.rewardTemplateId === undefined ? existing.reward_template_id : input.rewardTemplateId;
  const isActive = input.isActive === undefined ? existing.is_active : (input.isActive ? 1 : 0);
  const skipLiff = input.skipLiff === undefined ? existing.skip_liff : (input.skipLiff ? 1 : 0);
  const mediaName = input.mediaName === undefined ? existing.media_name : input.mediaName;
  const afAmount = input.afAmount === undefined ? existing.af_amount : input.afAmount;
  const afConfirmType = input.afConfirmType === undefined ? existing.af_confirm_type : input.afConfirmType;
  const lineAccountId = input.lineAccountId === undefined ? existing.line_account_id : input.lineAccountId;

  // Medium fix: af_confirm_type の runtime validation
  if (input.afConfirmType !== undefined && !isAfConfirmType(input.afConfirmType)) {
    throw new Error(`Invalid afConfirmType: ${input.afConfirmType}. Must be one of ${AF_CONFIRM_TYPES.join(', ')}.`);
  }

  await db
    .prepare(
      `UPDATE tracked_links
         SET name = ?, tag_id = ?, scenario_id = ?,
             intro_template_id = ?, reward_template_id = ?, is_active = ?,
             skip_liff = ?, media_name = ?, af_amount = ?, af_confirm_type = ?,
             line_account_id = ?,
             updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      name, tagId, scenarioId,
      introTemplateId, rewardTemplateId, isActive,
      skipLiff, mediaName, afAmount, afConfirmType,
      lineAccountId,
      now, id,
    )
    .run();

  return getTrackedLinkById(db, id);
}

export async function deleteTrackedLink(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tracked_links WHERE id = ?`).bind(id).run();
}

// ── Click Recording ───────────────────────────────────────────────────────────

export interface RecordLinkClickInput {
  trackedLinkId: string;
  friendId?: string | null;
  // L-TRACK 互換: 認証スキップモードで click時点で保存するアトリビューション情報
  ltp?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  ttclid?: string | null;
  twclid?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  uaFingerprint?: string | null;
}

/**
 * 後方互換 wrapper. 既存の `recordLinkClick(db, linkId, friendId)` 呼び出しを維持。
 * 拡張アトリビューション情報を保存したい場合は `recordLinkClickExtended` を使う。
 */
export async function recordLinkClick(
  db: D1Database,
  trackedLinkId: string,
  friendId?: string | null,
): Promise<LinkClick> {
  return recordLinkClickExtended(db, { trackedLinkId, friendId });
}

/**
 * L-TRACK 互換: クリック記録（IP/UA/ltp/fbclid 等含む）。
 * 認証スキップモード（skip_liff=1）で friend_id 未確定のクリックを記録するために使う。
 * 後に follow webhook で時間窓+IP+UA 突合で friend_id を埋める。
 */
export async function recordLinkClickExtended(
  db: D1Database,
  input: RecordLinkClickInput,
): Promise<LinkClick> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO link_clicks (
         id, tracked_link_id, friend_id, clicked_at,
         ltp, fbclid, gclid, ttclid, twclid,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term,
         user_agent, ip_address, ua_fingerprint
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.trackedLinkId, input.friendId ?? null, now,
      input.ltp ?? null, input.fbclid ?? null, input.gclid ?? null, input.ttclid ?? null, input.twclid ?? null,
      input.utmSource ?? null, input.utmMedium ?? null, input.utmCampaign ?? null, input.utmContent ?? null, input.utmTerm ?? null,
      input.userAgent ?? null, input.ipAddress ?? null, input.uaFingerprint ?? null,
    )
    .run();

  await db
    .prepare(
      `UPDATE tracked_links SET click_count = click_count + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(now, input.trackedLinkId)
    .run();

  return (await db
    .prepare(`SELECT * FROM link_clicks WHERE id = ?`)
    .bind(id)
    .first<LinkClick>())!;
}

// ── Anonymous Click Matching (L-TRACK 認証スキップモード用) ────────────────

export interface AnonymousClickMatch {
  click: LinkClick;
  strategy: 'ip_ua' | 'ua_only' | 'ip_only' | 'time_only';
  confidence: number; // 0.0 - 1.0
}

/**
 * follow webhook 受信時に呼ぶ。
 * 時間窓内の friend_id=NULL の click を、IP + UA fingerprint で突合する。
 *
 * 重要: LINE follow webhook には IP/UA が来ない（公式仕様）ため、
 * このルートで取れるシグナルは「時間」のみ。IP/UA を webhook 側で渡せる場合
 * （例: LIFF経由で取得 → message 経由で送る等）は併用して精度を上げる。
 *
 * confidence:
 *   - 0.95: ip + ua_fingerprint 完全一致
 *   - 0.70: ua_fingerprint のみ一致
 *   - 0.55: ip のみ一致
 *   - 0.40: 時間窓内に唯一の未マッチ click（最終手段）
 */
export async function findRecentAnonymousClickMatch(
  db: D1Database,
  opts: {
    windowSeconds: number;
    ipAddress?: string;
    uaFingerprint?: string;
    lineAccountId?: string | null; // multi-account 境界（あれば指定）
  },
): Promise<AnonymousClickMatch | null> {
  // Critical fix: cutoff を jstNow と同じ JST ISO 形式に揃える（ZとローカルTZの混在を避ける）
  const cutoff = toJstString(new Date(Date.now() - opts.windowSeconds * 1000));

  // Critical fix: skip_liff=1 のトラックリンクに限定（通常リンクの友だち未確定clickを誤マッチしない）
  // High fix: line_account_id 境界。friend の line_account_id と tracked_link の line_account_id が一致するもののみ。
  // tracked_link.line_account_id IS NULL（未指定）は any-account として後方互換で許容。
  const accountFilter = opts.lineAccountId
    ? `AND (tl.line_account_id IS NULL OR tl.line_account_id = ?)`
    : '';
  const baseFrom = `link_clicks lc INNER JOIN tracked_links tl ON tl.id = lc.tracked_link_id AND tl.skip_liff = 1 ${accountFilter}`;

  const accountBindArgs = opts.lineAccountId ? [opts.lineAccountId] : [];

  // 戦略1: IP + UA fingerprint 完全一致
  if (opts.ipAddress && opts.uaFingerprint) {
    const r = await db
      .prepare(
        `SELECT lc.* FROM ${baseFrom}
         WHERE lc.friend_id IS NULL
           AND lc.ip_address = ?
           AND lc.ua_fingerprint = ?
           AND lc.clicked_at >= ?
         ORDER BY lc.clicked_at DESC
         LIMIT 1`,
      )
      .bind(...accountBindArgs, opts.ipAddress, opts.uaFingerprint, cutoff)
      .first<LinkClick>();
    if (r) return { click: r, strategy: 'ip_ua', confidence: 0.95 };
  }

  // 戦略2: UA fingerprint のみ一致
  if (opts.uaFingerprint) {
    const r = await db
      .prepare(
        `SELECT lc.* FROM ${baseFrom}
         WHERE lc.friend_id IS NULL
           AND lc.ua_fingerprint = ?
           AND lc.clicked_at >= ?
         ORDER BY lc.clicked_at DESC
         LIMIT 1`,
      )
      .bind(...accountBindArgs, opts.uaFingerprint, cutoff)
      .first<LinkClick>();
    if (r) return { click: r, strategy: 'ua_only', confidence: 0.70 };
  }

  // 戦略3: IP のみ一致
  if (opts.ipAddress) {
    const r = await db
      .prepare(
        `SELECT lc.* FROM ${baseFrom}
         WHERE lc.friend_id IS NULL
           AND lc.ip_address = ?
           AND lc.clicked_at >= ?
         ORDER BY lc.clicked_at DESC
         LIMIT 1`,
      )
      .bind(...accountBindArgs, opts.ipAddress, cutoff)
      .first<LinkClick>();
    if (r) return { click: r, strategy: 'ip_only', confidence: 0.55 };
  }

  // 戦略4: 時間窓内に唯一の未マッチ click（最終手段・time_only）
  // 注意: 複数あれば突合不可能（L-TRACK の小谷さん失敗パターン）。
  // CAPI に送信する場合は match_confidence で除外推奨（time_only=0.40）。
  const candidates = await db
    .prepare(
      `SELECT lc.* FROM ${baseFrom}
       WHERE lc.friend_id IS NULL
         AND lc.clicked_at >= ?
       ORDER BY lc.clicked_at DESC
       LIMIT 2`,
    )
    .bind(...accountBindArgs, cutoff)
    .all<LinkClick>();
  if (candidates.results.length === 1) {
    return { click: candidates.results[0], strategy: 'time_only', confidence: 0.40 };
  }

  return null;
}

/**
 * マッチング成功時に呼ぶ。click に friend_id を埋め、マッチ情報を記録する。
 * High fix: 同時 follow による二重マッチ時の上書きを防ぐため、WHERE friend_id IS NULL を必須に。
 * 戻り値で実際に書き換わったかを示す（false なら別 follow がすでにマッチ済み）。
 */
export async function attachFriendToClick(
  db: D1Database,
  clickId: string,
  friendId: string,
  strategy: string,
  confidence: number,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE link_clicks
         SET friend_id = ?, matched_at = ?, match_strategy = ?, match_confidence = ?
       WHERE id = ?
         AND friend_id IS NULL`,
    )
    .bind(friendId, now, strategy, confidence, clickId)
    .run();
  // D1 の RunResult.meta.changes（書き換え行数）で実際に書き換わったかを判定
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  return changes > 0;
}

export interface LinkClickWithFriend extends LinkClick {
  friend_display_name: string | null;
}

export async function getLinkClicks(
  db: D1Database,
  trackedLinkId: string,
): Promise<LinkClickWithFriend[]> {
  const result = await db
    .prepare(
      `SELECT lc.*, f.display_name as friend_display_name
       FROM link_clicks lc
       LEFT JOIN friends f ON f.id = lc.friend_id
       WHERE lc.tracked_link_id = ?
       ORDER BY lc.clicked_at DESC`,
    )
    .bind(trackedLinkId)
    .all<LinkClickWithFriend>();
  return result.results;
}

