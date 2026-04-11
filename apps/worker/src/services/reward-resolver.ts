import type { MessageTemplate, TrackedLink, Friend } from '@line-crm/db';

/**
 * Per-campaign reward template resolver.
 *
 * Priority:
 *   1. If `requestedTrackedLinkId` is provided AND that tracked_link has a
 *      reward_template_id, use it. This is how X Harness campaign settings
 *      flow through to LINE form rewards: the campaign's tracked link id is
 *      passed via `?ref=` from /r/:ref → LIFF → form submit body.
 *   2. Otherwise fall back to friends.first_tracked_link_id (legacy
 *      first-touch attribution). Preserves backward compat for tracked
 *      links that don't pass `ref` through.
 *   3. If neither yields a template, return null. Caller (forms.ts) then
 *      falls back to form.on_submit_message_*.
 *
 * Pure function: DB accessors are injected so this is unit-testable
 * without spinning up D1/Hono.
 */
export interface RewardResolverDeps {
  getFriendById: (db: D1Database, id: string) => Promise<Friend | null>;
  getTrackedLinkById: (db: D1Database, id: string) => Promise<TrackedLink | null>;
  getMessageTemplateById: (db: D1Database, id: string) => Promise<MessageTemplate | null>;
}

export async function resolveRewardTemplate(
  db: D1Database,
  args: { friendId: string; requestedTrackedLinkId: string | null },
  deps: RewardResolverDeps,
): Promise<MessageTemplate | null> {
  // 1. Per-campaign: ref-driven. When `requestedTrackedLinkId` resolves to a
  // real tracked_link, that link is authoritative — even if its
  // reward_template_id is NULL. Otherwise a campaign that intentionally opts
  // out of a reward would leak some other campaign's reward via first-touch.
  // We return null in that case so the caller falls back to the form's own
  // on_submit_message_*.
  //
  // Only when `requestedTrackedLinkId` does NOT resolve to a known link
  // (typo / stale URL / deleted) do we fall through to first-touch.
  if (args.requestedTrackedLinkId) {
    const link = await deps.getTrackedLinkById(db, args.requestedTrackedLinkId);
    if (link) {
      if (!link.reward_template_id) return null;
      return await deps.getMessageTemplateById(db, link.reward_template_id);
    }
  }

  // 2. Fallback: first-touch attribution.
  const friend = await deps.getFriendById(db, args.friendId);
  if (friend?.first_tracked_link_id) {
    const link = await deps.getTrackedLinkById(db, friend.first_tracked_link_id);
    if (link?.reward_template_id) {
      const tpl = await deps.getMessageTemplateById(db, link.reward_template_id);
      if (tpl) return tpl;
    }
  }

  return null;
}
