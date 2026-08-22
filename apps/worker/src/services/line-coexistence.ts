import type { SegmentCondition } from './segment-query.js';
import { jstNow } from '@line-crm/db';

export type LineManagementOwner = 'harness' | 'lstep';
export type WebhookClassificationOrigin = 'follow' | 'message' | 'postback';

export interface LineCoexistencePolicy {
  line_account_id: string;
  harness_tag_id: string;
  lstep_tag_id: string;
  cutover_at: string;
  is_active: number;
}

function validPolicy(row: LineCoexistencePolicy | null): LineCoexistencePolicy | null {
  if (
    !row
    || typeof row.line_account_id !== 'string'
    || typeof row.harness_tag_id !== 'string'
    || typeof row.lstep_tag_id !== 'string'
    || typeof row.cutover_at !== 'string'
    || row.harness_tag_id === row.lstep_tag_id
    || row.is_active !== 1
  ) {
    return null;
  }
  return row;
}

// Several route tests use intentionally tiny D1 doubles that implement only
// the methods exercised by the original route. Treat a missing `.first()` on
// those non-D1 objects as "no policy"; a real D1 query error still propagates.
async function firstOrNull<T>(statement: D1PreparedStatement): Promise<T | null> {
  const candidate = statement as unknown as { first?: () => Promise<T | null> };
  return typeof candidate.first === 'function' ? candidate.first() : null;
}

/**
 * Resolve an active coexistence policy. Legacy callers sometimes omit the
 * account ID; that is safe only when this deployment has exactly one active
 * coexistence policy, so use that single row as the default.
 */
export async function getLineCoexistencePolicy(
  db: D1Database,
  lineAccountId?: string | null,
): Promise<LineCoexistencePolicy | null> {
  if (lineAccountId) {
    const statement = db
      .prepare(
        `SELECT line_account_id, harness_tag_id, lstep_tag_id, cutover_at, is_active
           FROM line_coexistence_policies
          WHERE line_account_id = ? AND is_active = 1`,
      )
      .bind(lineAccountId);
    const row = await firstOrNull<LineCoexistencePolicy>(statement);
    return validPolicy(row);
  }

  const statement = db
    .prepare(
      `SELECT line_account_id, harness_tag_id, lstep_tag_id, cutover_at, is_active
         FROM line_coexistence_policies
        WHERE is_active = 1
          AND (SELECT COUNT(*) FROM line_coexistence_policies WHERE is_active = 1) = 1
        ORDER BY line_account_id
        LIMIT 1`,
    )
    ;
  const row = await firstOrNull<LineCoexistencePolicy>(statement);
  return validPolicy(row);
}

async function currentOwner(
  db: D1Database,
  friendId: string,
  policy: LineCoexistencePolicy,
): Promise<LineManagementOwner | null> {
  const statement = db
    .prepare(
      `SELECT tag_id
         FROM friend_tags
        WHERE friend_id = ? AND tag_id IN (?, ?)
        ORDER BY CASE tag_id WHEN ? THEN 0 ELSE 1 END
        LIMIT 1`,
    )
    .bind(friendId, policy.harness_tag_id, policy.lstep_tag_id, policy.harness_tag_id);
  const row = await firstOrNull<{ tag_id: string }>(statement);
  if (!row) return null;
  return row.tag_id === policy.harness_tag_id ? 'harness' : 'lstep';
}

/**
 * Apply exactly one management-owner tag and bind the friend to the account.
 * These are system classification tags, so no tag-added scenario or mileage
 * side effects are fired.
 */
export async function setFriendManagementOwner(
  db: D1Database,
  friendId: string,
  policy: LineCoexistencePolicy,
  owner: LineManagementOwner,
): Promise<void> {
  const selectedTagId = owner === 'harness' ? policy.harness_tag_id : policy.lstep_tag_id;
  const now = jstNow();
  await db.batch([
    db
      .prepare(
        `UPDATE friends
            SET line_account_id = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(policy.line_account_id, now, friendId),
    db
      .prepare(
        `DELETE FROM friend_tags
          WHERE friend_id = ? AND tag_id IN (?, ?) AND tag_id != ?`,
      )
      .bind(
        friendId,
        policy.harness_tag_id,
        policy.lstep_tag_id,
        selectedTagId,
      ),
    db
      .prepare(
        `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
         VALUES (?, ?, ?)`,
      )
      .bind(friendId, selectedTagId, now),
  ]);
}

/**
 * Webhook-only classification:
 * - a new follow after cutover belongs to L Harness;
 * - a previously unseen user who only sends a message/postback is treated as
 *   an existing L-Step user;
 * - an existing explicit owner tag always wins.
 */
export async function classifyWebhookFriendManagement(
  db: D1Database,
  input: {
    friendId: string;
    lineAccountId?: string | null;
    origin: WebhookClassificationOrigin;
    eventTimestamp?: number;
  },
): Promise<LineManagementOwner | null> {
  const policy = await getLineCoexistencePolicy(db, input.lineAccountId);
  if (!policy) return null;

  const existing = await currentOwner(db, input.friendId, policy);
  if (existing) {
    // Still repair account binding for legacy NULL rows.
    await db
      .prepare('UPDATE friends SET line_account_id = ? WHERE id = ? AND line_account_id IS NULL')
      .bind(policy.line_account_id, input.friendId)
      .run();
    return existing;
  }

  const eventMs = input.eventTimestamp ?? 0;
  const cutoverMs = Date.parse(policy.cutover_at);
  const isPostCutoverFollow =
    input.origin === 'follow'
    && Number.isFinite(cutoverMs)
    && eventMs >= cutoverMs;
  const owner: LineManagementOwner = isPostCutoverFollow ? 'harness' : 'lstep';
  await setFriendManagementOwner(db, input.friendId, policy, owner);
  return owner;
}

/** A verified LIFF/ref visit is explicit L Harness provenance and may migrate a legacy user. */
export async function markFriendAsHarnessManaged(
  db: D1Database,
  input: {
    friendId: string;
    lineAccountId?: string | null;
    accountChannelId?: string | null;
  },
): Promise<boolean> {
  let accountId = input.lineAccountId ?? null;
  if (!accountId && input.accountChannelId) {
    const accountStatement = db
      .prepare('SELECT id FROM line_accounts WHERE channel_id = ? AND is_active = 1')
      .bind(input.accountChannelId);
    const account = await firstOrNull<{ id: string }>(accountStatement);
    accountId = account?.id ?? null;
  }
  const policy = await getLineCoexistencePolicy(db, accountId);
  if (!policy) return false;
  await setFriendManagementOwner(db, input.friendId, policy, 'harness');
  return true;
}

/** Safe audience used for every bulk send from a coexistence account. */
export function coexistenceAudienceCondition(
  policy: LineCoexistencePolicy,
  targetTagId?: string | null,
): SegmentCondition {
  const rules: SegmentCondition['rules'] = [
    { type: 'is_following', value: true },
    { type: 'tag_exists', value: policy.harness_tag_id },
    { type: 'tag_not_exists', value: policy.lstep_tag_id },
  ];
  if (targetTagId) rules.push({ type: 'tag_exists', value: targetTagId });
  return { operator: 'AND', rules };
}

/** SQL predicate equivalent of coexistenceAudienceCondition for existing queries. */
export function coexistenceFriendSqlGuard(
  policy: LineCoexistencePolicy,
  alias = 'f',
): { where: string; binds: unknown[] } {
  return {
    where: `${alias}.line_account_id = ?
      AND EXISTS (
        SELECT 1 FROM friend_tags coexist_h
         WHERE coexist_h.friend_id = ${alias}.id AND coexist_h.tag_id = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM friend_tags coexist_l
         WHERE coexist_l.friend_id = ${alias}.id AND coexist_l.tag_id = ?
      )`,
    binds: [policy.line_account_id, policy.harness_tag_id, policy.lstep_tag_id],
  };
}
