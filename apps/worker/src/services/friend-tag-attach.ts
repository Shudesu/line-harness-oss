import {
  getScenarios, enrollFriendInScenario, jstNow, enqueueMileageEvent,
  getFriendById, getLineAccountById, getLineAccountByChannelId, resolveDefaultLineAccount,
} from '@line-crm/db';
import { fireEvent } from './event-bus.js';
import { pushImmediateFirstStep, type ImmediatePushContext } from './immediate-first-step.js';
import { resolveScenarioDeliveryFriend } from './step-delivery.js';
import {
  claimTagEffects,
  assertTagChangeBudget,
  createTagAutomationDispatch,
  resolveTagEventAccount,
  tagChangeKey,
  TagAutomationCycleError,
  type TagAutomationDispatch,
} from './tag-automation-context.js';

// friend に tag を attach し、`POST /api/friends/:id/tags` と同じ side effects を発火する。
// side effects: tag_added シナリオ enrollment + tag_change イベント (automation/webhook/scoring 用)。
//
// 新規付与のときだけ side effects を発火する (`changes` を見る)。同じ friend に同じ tag を
// 自動付与で繰り返し叩いたとき、シナリオの重複 enrollment や tag_change の重複発火を防ぐ。
//
// POST /api/friends/:id/tags は手動操作の signal として「毎クリックで発火」する設計のため、
// この helper には合流させていない (重複 enroll はチェックがあるが tag_change は冪等でない)。
// 自動経路 (予約 auto-tag 等) はここ経由で呼ぶ。
// `push` (optional): when supplied, a tag_added scenario whose first step is
// delay-0 gets that step pushed IMMEDIATELY after enrollment instead of
// waiting for the delivery cron — welcome messages should land the moment
// the user arrives. Callers without a push context keep cron delivery.
export async function attachTagAndFireSideEffects(
  db: D1Database,
  friendId: string,
  tagId: string,
  push?: ImmediatePushContext,
  options?: { lineAccountId?: string | null; dispatch?: TagAutomationDispatch },
): Promise<{ added: boolean }> {
  const dispatch = options?.dispatch ?? createTagAutomationDispatch();
  const effectKey = tagChangeKey(friendId, tagId, 'add');
  assertTagChangeBudget(dispatch, effectKey);
  let eventAccountId = options?.lineAccountId;
  if (options?.lineAccountId || push?.accountChannelId) {
    // A verified OAuth/LIFF channel fills the gap before the follow webhook
    // assigns the friend. An assigned friend's own account remains authoritative.
    const account = await resolveTagEventAccount(db, friendId, options?.lineAccountId, push?.accountChannelId);
    eventAccountId = account.accountId;
  }
  const assignedAt = jstNow();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, assignedAt)
    .run();
  const added = (result.meta?.changes ?? 0) > 0;
  if (!added) return { added: false };
  if (!claimTagEffects(dispatch, effectKey)) {
    console.warn('Repeated tag automation side effects skipped within this dispatch');
    // The tag changed again, unlike a normal already-attached no-op. Let the
    // automation engine record this suppressed cascade in actions_result.
    throw new TagAutomationCycleError();
  }

  try {
    await enqueueMileageEvent(db, {
      eventType: 'tag_added',
      source: 'tag',
      sourceEventId: `${friendId}:${tagId}:${assignedAt}`,
      friendId,
      subjectKey: tagId,
      metadata: { tagId },
      occurredAt: assignedAt,
    });
  } catch (error) {
    console.error('tag mileage enqueue failed:', error);
  }

  const scenarios = await getScenarios(db);
  for (const scenario of scenarios) {
    if (
      scenario.trigger_type === 'tag_added' &&
      scenario.is_active &&
      scenario.trigger_tag_id === tagId
    ) {
      const existing = await db
        .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
        .bind(friendId, scenario.id)
        .first();
      if (!existing) {
        const enrollment = await enrollFriendInScenario(db, friendId, scenario.id);
        if (push && enrollment) {
          // Enrollment may intentionally target a UUID-linked friend in another
          // account. Reuse the cron resolver instead of rejecting that workflow
          // or sending another account's scenario through the source friend's bot.
          const sourceFriend = await getFriendById(db, friendId);
          const recipient = sourceFriend
            ? await resolveScenarioDeliveryFriend(db, sourceFriend, scenario.line_account_id)
            : null;
          if (recipient?.is_following) {
            const accountId = scenario.line_account_id ?? recipient.line_account_id;
            const account = accountId
              ? await getLineAccountById(db, accountId)
              : push.accountChannelId
                ? await getLineAccountByChannelId(db, push.accountChannelId)
                : await resolveDefaultLineAccount(db);
            if (account?.is_active && account.channel_access_token?.trim()) {
              await pushImmediateFirstStep(db, recipient.id, scenario.id, {
                ...push,
                accountChannelId: account.channel_id,
                defaultAccessToken: account.channel_access_token,
              }, { enrollment });
            }
          }
        }
      }
    }
  }

  await fireEvent(db, 'tag_change', { friendId, eventData: { tagId, action: 'add' } }, undefined, eventAccountId, dispatch);
  return { added: true };
}
