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
  dedup_key: string | null;
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
  /** Auto-generated links only — see getOrCreateAutoTrackedLink. */
  dedupKey?: string | null;
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
          `INSERT INTO tracked_links (id, name, original_url, tag_id, scenario_id, intro_template_id, reward_template_id, line_account_id, short_code, dedup_key, is_active, click_count, og_title, og_description, og_image_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
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
          input.dedupKey ?? null,
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

// ── Auto-generated links (auto-track) ────────────────────────────────────────

export interface AutoTrackedLinkInput {
  originalUrl: string;
  lineAccountId?: string | null;
}

function autoTrackedLinkDedupKey(input: AutoTrackedLinkInput): string {
  // Must match the backfill expression in migration 050.
  return `${input.lineAccountId ?? ''}|${input.originalUrl}`;
}

async function getTrackedLinkByDedupKey(
  db: D1Database,
  dedupKey: string,
): Promise<TrackedLink | null> {
  return db
    .prepare(`SELECT * FROM tracked_links WHERE dedup_key = ?`)
    .bind(dedupKey)
    .first<TrackedLink>();
}

/**
 * Reuse (or create) the single auto-generated tracked link for an
 * (original_url, line_account_id) pair. auto-track runs inside per-friend
 * delivery loops, so minting a fresh row per send would pile up thousands of
 * one-shot links and scatter click analytics — instead each pair owns exactly
 * one row, enforced by the UNIQUE index on dedup_key. Manually created links
 * have no dedup_key and are never touched.
 */
export async function getOrCreateAutoTrackedLink(
  db: D1Database,
  input: AutoTrackedLinkInput,
): Promise<TrackedLink> {
  const dedupKey = autoTrackedLinkDedupKey(input);
  const existing = await getTrackedLinkByDedupKey(db, dedupKey);
  if (existing) return reactivateIfNeeded(db, existing);
  try {
    return await createTrackedLink(db, {
      name: `auto: ${input.originalUrl.slice(0, 60)}`,
      originalUrl: input.originalUrl,
      lineAccountId: input.lineAccountId ?? null,
      dedupKey,
    });
  } catch (err) {
    // Concurrent deliveries can race past the SELECT; the UNIQUE index makes
    // exactly one INSERT win — losers fall back to the winner's row.
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE.*dedup_key/i.test(msg)) {
      const winner = await getTrackedLinkByDedupKey(db, dedupKey);
      if (winner) return reactivateIfNeeded(db, winner);
    }
    throw err;
  }
}

/**
 * The returned link is about to be embedded in an outgoing message, so it must
 * resolve — /t rejects inactive links. Pre-dedup behavior minted a fresh active
 * link on every send, so reviving a deactivated auto link matches what
 * recipients always got.
 */
async function reactivateIfNeeded(
  db: D1Database,
  link: TrackedLink,
): Promise<TrackedLink> {
  if (link.is_active) return link;
  const now = jstNow();
  await db
    .prepare(`UPDATE tracked_links SET is_active = 1, updated_at = ? WHERE id = ?`)
    .bind(now, link.id)
    .run();
  return { ...link, is_active: 1, updated_at: now };
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

