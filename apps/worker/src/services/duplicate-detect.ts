/**
 * Cross-account duplicate friend detection via LINE profile picture URL tokens.
 *
 * LINE profile image URLs contain a user-specific token in the middle (pos 10-90 of path)
 * that is consistent across channels, while the prefix and suffix differ per channel.
 * We extract this token and match friends across accounts to auto-tag duplicates.
 */

import { URL_TOKEN_SQL } from '../lib/url-token.js';

interface DuplicateTagConfig {
  /** Map of line_account_id → duplicate tag ID. */
  tagIds: Record<string, string>;
  /** tagId → { name, color } used by ensureTags. */
  tagNames: Record<string, { name: string; color: string }>;
}

/**
 * Load both account_settings rows in a single SELECT so a concurrent operator
 * updating mapping + names cannot leave a cron tick with a mixed snapshot
 * (e.g. new mapping, old names) — which would trip the friend_tags → tags FK.
 *
 * Read on every cron tick so DB-side updates take effect without redeploy.
 */
async function getDuplicateTagConfig(db: D1Database): Promise<DuplicateTagConfig> {
  const result = await db.prepare(
    `SELECT key, value FROM account_settings
     WHERE line_account_id = 'system'
       AND key IN ('duplicate_tag_mapping', 'duplicate_tag_names')`
  ).all<{ key: string; value: string }>();

  const config: DuplicateTagConfig = { tagIds: {}, tagNames: {} };
  for (const row of result.results ?? []) {
    if (row.key === 'duplicate_tag_mapping') {
      config.tagIds = JSON.parse(row.value);
    } else if (row.key === 'duplicate_tag_names') {
      config.tagNames = JSON.parse(row.value);
    }
  }
  return config;
}

async function ensureTags(
  db: D1Database,
  tagNames: Record<string, { name: string; color: string }>
): Promise<void> {
  if (Object.keys(tagNames).length === 0) return;
  const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');
  for (const [id, { name, color }] of Object.entries(tagNames)) {
    await db.prepare(
      `INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`
    ).bind(id, name, color, now).run();
  }
}

/**
 * Detect duplicate friends across all accounts and auto-tag them.
 * Runs incrementally — only processes friends updated since last run.
 */
export async function processDuplicateDetection(db: D1Database): Promise<void> {
  // Load tag mapping + names atomically (single SELECT) so they cannot drift
  // mid-update.
  const { tagIds, tagNames } = await getDuplicateTagConfig(db);
  if (Object.keys(tagIds).length === 0) {
    // No mapping configured — skip duplicate detection.
    // Surfacing this in logs so the operator notices when the feature is
    // expected to be active but the configuration row has gone missing.
    console.warn(
      '[duplicate-detect] account_settings.duplicate_tag_mapping is empty — feature disabled'
    );
    return;
  }

  // Ensure duplicate tags exist
  await ensureTags(db, tagNames);

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
  `).bind(lastRun, lastRun).all<{ id: string; line_account_id: string | null; url_token: string | null }>();

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

    // Find matching friends in OTHER accounts within the SAME organization.
    // Accounts with organization_id = NULL never match each other (or anything
    // else) — cross-tenant matching before an operator has explicitly grouped
    // accounts under one organization would risk leaking one customer's
    // identity into an unrelated org's friend list.
    const matches = await db.prepare(`
      SELECT f.id, f.line_account_id
      FROM friends f
      JOIN line_accounts la_other ON la_other.id = f.line_account_id
      JOIN line_accounts la_self ON la_self.id = ?
      WHERE f.is_following = 1
        AND f.id != ?
        AND f.line_account_id != ?
        AND la_other.organization_id IS NOT NULL
        AND la_other.organization_id = la_self.organization_id
        AND (${URL_TOKEN_SQL.replace(/picture_url/g, 'f.picture_url')}) = ?
        AND f.picture_url IS NOT NULL
        AND LENGTH(f.picture_url) > 50
    `).bind(friend.line_account_id, friend.id, friend.line_account_id, friend.url_token)
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
