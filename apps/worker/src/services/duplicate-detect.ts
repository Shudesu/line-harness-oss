/**
 * Cross-account duplicate friend detection via LINE profile picture URL tokens.
 *
 * LINE profile image URLs contain a user-specific token in the middle (pos 10-90 of path)
 * that is consistent across channels, while the prefix and suffix differ per channel.
 * We extract this token and match friends across accounts to auto-tag duplicates.
 */

import { hasColumn } from '../utils/db-compat.js';

/**
 * Map of line_account_id → duplicate tag ID.
 * Loaded from DB (account_settings key='duplicate_tag_mapping') at runtime.
 * Fallback to empty if not configured.
 */
let cachedTagIds: Record<string, string> | null = null;

async function getTagIds(db: D1Database): Promise<Record<string, string>> {
  if (cachedTagIds) return cachedTagIds;
  const row = await db.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = 'system' AND key = 'duplicate_tag_mapping'`
  ).first<{ value: string }>();
  const result: Record<string, string> = row ? JSON.parse(row.value) : {};
  cachedTagIds = result;
  return result;
}

/**
 * Tag names/colors loaded from DB (account_settings key='duplicate_tag_names').
 * Format: { "tag-dup-xh1": { "name": "重複:XH1", "color": "#8B5CF6" }, ... }
 */
let cachedTagNames: Record<string, { name: string; color: string }> | null = null;

async function getTagNames(db: D1Database): Promise<Record<string, { name: string; color: string }>> {
  if (cachedTagNames) return cachedTagNames;
  const row = await db.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = 'system' AND key = 'duplicate_tag_names'`
  ).first<{ value: string }>();
  const result: Record<string, { name: string; color: string }> = row ? JSON.parse(row.value) : {};
  cachedTagNames = result;
  return result;
}

async function ensureTags(db: D1Database): Promise<void> {
  const tagNames = await getTagNames(db);
  if (Object.keys(tagNames).length === 0) return;
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');
  for (const [id, { name, color }] of Object.entries(tagNames)) {
    await db.prepare(
      `INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`
    ).bind(id, name, color, now).run();
  }
}

const URL_TOKEN_SQL = `
  CASE
    WHEN picture_url LIKE 'https://sprofile.line-scdn.net/%' THEN SUBSTR(picture_url, 42, 80)
    WHEN picture_url LIKE 'https://profile.line-scdn.net/%' THEN SUBSTR(picture_url, 41, 80)
    ELSE NULL
  END
`;

/**
 * Detect duplicate friends across all accounts and auto-tag them.
 * Runs incrementally — only processes friends updated since last run.
 */
export async function processDuplicateDetection(db: D1Database): Promise<void> {
  if (!await hasColumn(db, 'friends', 'line_account_id')) {
    return;
  }

  // Load tag mapping from DB
  const tagIds = await getTagIds(db);
  if (Object.keys(tagIds).length === 0) {
    // No mapping configured — skip duplicate detection
    return;
  }

  // Ensure duplicate tags exist
  await ensureTags(db);

  // Get last run timestamp from account_settings
  const lastRunRow = await db.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = 'system' AND key = 'duplicate_detect_last_run'`
  ).first<{ value: string }>();
  const lastRun = lastRunRow?.value ?? '2020-01-01T00:00:00';

  // Find friends with picture_url that were created or updated since last run
  const candidates = await db.prepare(`
    SELECT id, line_account_id, (${URL_TOKEN_SQL}) as url_token
    FROM friends
    WHERE is_following = 1
      AND picture_url IS NOT NULL
      AND LENGTH(picture_url) > 50
      AND (created_at > ? OR updated_at > ?)
  `).bind(lastRun, lastRun).all<{ id: string; line_account_id: string; url_token: string | null }>();

  if (!candidates.results || candidates.results.length === 0) {
    return; // Nothing new to process
  }

  const newFriends = candidates.results.filter(f => f.url_token);
  if (newFriends.length === 0) return;

  console.log(`[duplicate-detect] Processing ${newFriends.length} new/updated friends`);

  // For each new friend, find matches in other accounts
  let taggedCount = 0;
  for (const friend of newFriends) {
    if (!friend.url_token || !friend.line_account_id) continue;

    // Find matching friends in OTHER accounts
    const matches = await db.prepare(`
      SELECT id, line_account_id
      FROM friends
      WHERE is_following = 1
        AND id != ?
        AND line_account_id != ?
        AND (${URL_TOKEN_SQL}) = ?
        AND picture_url IS NOT NULL
        AND LENGTH(picture_url) > 50
    `).bind(friend.id, friend.line_account_id, friend.url_token)
      .all<{ id: string; line_account_id: string }>();

    if (!matches.results || matches.results.length === 0) continue;

    // Tag both sides
    const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');

    for (const match of matches.results) {
      const matchTagId = tagIds[match.line_account_id];
      const friendTagId = tagIds[friend.line_account_id];

      // Tag friend with the match's account tag (e.g., "重複:①")
      if (matchTagId) {
        await db.prepare(
          `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`
        ).bind(friend.id, matchTagId, now).run();
      }

      // Tag match with the friend's account tag (e.g., "重複:XH1")
      if (friendTagId) {
        await db.prepare(
          `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`
        ).bind(match.id, friendTagId, now).run();
      }

      taggedCount++;
    }
  }

  // Update last run timestamp
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');
  await db.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, 'system', 'duplicate_detect_last_run', ?, ?, ?)
     ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`
  ).bind(crypto.randomUUID(), now, now, now, now, now).run();

  if (taggedCount > 0) {
    console.log(`[duplicate-detect] Tagged ${taggedCount} duplicate pairs`);
  }
}
