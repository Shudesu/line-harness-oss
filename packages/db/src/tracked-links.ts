import { jstNow } from './utils.js';
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
  line_account_id: string | null;
  short_code: string | null;
  is_active: number;
  click_count: number;
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

/**
 * Resolve a tracked link by either its UUID (legacy links) or its 7-char
 * short code. UUIDs are 36 chars with dashes so the two namespaces never
 * collide; try the cheap discriminator first, then fall back to the other
 * column to be safe against unexpected identifier shapes.
 */
export async function getTrackedLinkByIdOrShortCode(
  db: D1Database,
  idOrCode: string,
): Promise<TrackedLink | null> {
  const looksLikeUuid = idOrCode.length === 36 && idOrCode.includes('-');
  const first = looksLikeUuid
    ? await getTrackedLinkById(db, idOrCode)
    : await db
        .prepare(`SELECT * FROM tracked_links WHERE short_code = ?`)
        .bind(idOrCode)
        .first<TrackedLink>();
  if (first) return first;
  return looksLikeUuid
    ? db
        .prepare(`SELECT * FROM tracked_links WHERE short_code = ?`)
        .bind(idOrCode)
        .first<TrackedLink>()
    : getTrackedLinkById(db, idOrCode);
}

// Base62 alphabet — no ambiguity issues matter here (codes are copy-pasted,
// not hand-typed), so keep the full 62-char space: 62^7 ≈ 3.5 trillion.
const SHORT_CODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHORT_CODE_LENGTH = 7;

export function generateShortCode(): string {
  const bytes = new Uint8Array(SHORT_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) {
    code += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
  }
  return code;
}

export interface CreateTrackedLinkInput {
  name: string;
  originalUrl: string;
  tagId?: string | null;
  scenarioId?: string | null;
  introTemplateId?: string | null;
  rewardTemplateId?: string | null;
  lineAccountId?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
}

export async function createTrackedLink(
  db: D1Database,
  input: CreateTrackedLinkInput,
): Promise<TrackedLink> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // Retry on the (astronomically unlikely) short-code UNIQUE collision.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    const shortCode = generateShortCode();
    try {
      await db
        .prepare(
          `INSERT INTO tracked_links (id, name, original_url, tag_id, scenario_id, intro_template_id, reward_template_id, line_account_id, short_code, is_active, click_count, og_title, og_description, og_image_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          input.name,
          input.originalUrl,
          input.tagId ?? null,
          input.scenarioId ?? null,
          input.introTemplateId ?? null,
          input.rewardTemplateId ?? null,
          input.lineAccountId ?? null,
          shortCode,
          input.ogTitle ?? null,
          input.ogDescription ?? null,
          input.ogImageUrl ?? null,
          now,
          now,
        )
        .run();
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS && /UNIQUE.*short_code/i.test(msg)) continue;
      throw err;
    }
  }

  return (await getTrackedLinkById(db, id))!;
}

export interface UpdateTrackedLinkInput {
  name?: string;
  tagId?: string | null;
  scenarioId?: string | null;
  introTemplateId?: string | null;
  rewardTemplateId?: string | null;
  lineAccountId?: string | null;
  isActive?: boolean;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImageUrl?: string | null;
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
  const lineAccountId =
    input.lineAccountId === undefined ? existing.line_account_id : input.lineAccountId;
  const isActive = input.isActive === undefined ? existing.is_active : (input.isActive ? 1 : 0);
  const ogTitle = input.ogTitle === undefined ? existing.og_title : input.ogTitle;
  const ogDescription =
    input.ogDescription === undefined ? existing.og_description : input.ogDescription;
  const ogImageUrl =
    input.ogImageUrl === undefined ? existing.og_image_url : input.ogImageUrl;

  await db
    .prepare(
      `UPDATE tracked_links
         SET name = ?, tag_id = ?, scenario_id = ?, intro_template_id = ?, reward_template_id = ?, line_account_id = ?, is_active = ?, og_title = ?, og_description = ?, og_image_url = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(name, tagId, scenarioId, introTemplateId, rewardTemplateId, lineAccountId, isActive, ogTitle, ogDescription, ogImageUrl, now, id)
    .run();

  return getTrackedLinkById(db, id);
}

export async function deleteTrackedLink(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tracked_links WHERE id = ?`).bind(id).run();
}

// ── Click Recording ───────────────────────────────────────────────────────────

export async function recordLinkClick(
  db: D1Database,
  trackedLinkId: string,
  friendId?: string | null,
): Promise<LinkClick> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO link_clicks (id, tracked_link_id, friend_id, clicked_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, trackedLinkId, friendId ?? null, now)
    .run();

  await db
    .prepare(
      `UPDATE tracked_links SET click_count = click_count + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(now, trackedLinkId)
    .run();

  return (await db
    .prepare(`SELECT * FROM link_clicks WHERE id = ?`)
    .bind(id)
    .first<LinkClick>())!;
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

