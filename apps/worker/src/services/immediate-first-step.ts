import {
  getScenarioById,
  getFriendById,
  computeNextDeliveryAt,
  resolveStepContent,
  advanceFriendScenario,
  completeFriendScenario,
  claimFriendScenarioForDelivery,
  enrollFriendInScenario,
  getLineAccountByChannelId,
  getLineAccountById,
  addTagToFriend,
  jstNow,
  toJstString,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import {
  buildMessage,
  expandVariables,
  resolveMetadata,
  messageToLogPayload,
  evaluateCondition,
} from './step-delivery.js';
import { decorateForFriendPush } from './auto-track.js';

export interface ImmediatePushContext {
  defaultAccessToken: string;
  /** Base URL for {{...}} / {{auth_url:...}} link expansion. Pass the env
   *  WORKER_URL whenever it is in scope; undefined leaves those variables
   *  unexpanded (matching expandVariables' own fallback). */
  workerUrl?: string;
  accountChannelId?: string | null;
}

export interface EnrollmentRef {
  id: string;
  current_step_order: number;
}

export interface ImmediatePushOptions {
  /**
   * - 'once' (default): exactly-once with the cron via the claim protocol.
   *   The enrollment must already exist (caller-supplied or looked up) and
   *   still be at a step before step 1.
   * - 'every-click': click-campaign semantics (tracked link / entry route).
   *   Pushes on EVERY hit — re-clicks included — enrolling the friend itself
   *   (INSERT OR IGNORE). When the enrollment still owes step 1 it is
   *   CLAIMED like 'once' (fencing the cron and any concurrent follow-path
   *   sender); a failed claim means someone else is delivering right now, so
   *   the click is skipped instead of double-sending. Re-clicks on an
   *   already-advanced enrollment push without touching the row.
   */
  mode?: 'once' | 'every-click';
  /** Pre-created enrollment ('once' mode) — skips the lookup query. */
  enrollment?: EnrollmentRef | null;
  /**
   * Push target override. LIFF/OAuth callers know the LINE user id from the
   * id_token before the friend row is fully wired; without this the push
   * requires friend.line_user_id.
   */
  targetLineUserId?: string;
  /**
   * Send through the follow event's reply token (free, no push quota)
   * instead of resolving an access token and pushing. On failure the claim
   * is released so the cron delivers by push on schedule. messages_log
   * rows are stamped delivery_type='reply' automatically.
   */
  reply?: { client: Pick<LineClient, 'replyMessage'>; replyToken: string };
  /**
   * Skip the 60s messages_log duplicate probe. The follow-webhook friend_add
   * path sets this to preserve its historical semantics: a re-follow within
   * 60s of the previous welcome (possible once the prior enrollment
   * completed) must still be answered — the fresh INSERT + claim already
   * fence every same-flow race there.
   */
  skipCooldown?: boolean;
}

/**
 * Push a scenario's delay-0 first step to a friend RIGHT NOW — no cron wait —
 * then advance the enrollment so the delivery worker never re-sends step 1.
 *
 * Single implementation behind every instant-first-message entry point:
 * tag-triggered enrollment (friend-tag-attach), the click-campaign block in
 * applyRefAttribution (liff.ts), the follow-webhook friend_add /
 * referral-route enrollments, and the OAuth /auth/callback friend_add
 * auto-enroll loop (liff.ts).
 *
 * Exactly-once with the cron: the enrollment is CLAIMED
 * (claimFriendScenarioForDelivery, status active→delivering) before any
 * network call, using the same optimistic lock the cron delivery worker
 * uses — whichever side claims first owns step 1, the other backs off.
 * advance/complete after the push releases the claim (status back to
 * active / completed).
 *
 * Other guards:
 * - paused scenarios (is_active = 0) never send — same gate as the cron and
 *   the friend_add / tag_added trigger loops
 * - non-immediate first steps (delay > 0 / clock-time modes) return before
 *   claiming/enrolling — cron owns those untouched
 * - a 60s messages_log cooldown catches a racing sender the claim can't see
 *   (a different enrollment row, or a send logged before this row existed);
 *   in 'once' mode a cooldown hit advances WITHOUT pushing (and still
 *   attaches the reach tag — the racer delivered the step) so the fresh row
 *   is never re-delivered by the cron, in 'every-click' mode it simply skips
 * - unresolvable push target releases the claim so the cron can retry on
 *   schedule
 * - an unexpected throw after a successful send still advances the
 *   enrollment (best effort) so the cron cannot re-send; a throw before the
 *   send releases the claim instead of stranding the row in 'delivering'
 *   until the stuck-delivery sweep
 *
 * Returns true when a message was actually sent.
 */
export async function pushImmediateFirstStep(
  db: D1Database,
  friendId: string,
  scenarioId: string,
  ctx: ImmediatePushContext,
  options?: ImmediatePushOptions,
): Promise<boolean> {
  const mode = options?.mode ?? 'once';
  // Function-scope so the outer catch can settle a half-finished delivery.
  let claimedEnrollmentId: string | null = null;
  let sent = false;
  let settleAfterSend: (() => Promise<void>) | null = null;
  try {
    const scenarioRow = await getScenarioById(db, scenarioId);
    if (!scenarioRow) return false;
    // Paused scenarios never send. The cron's due-for-delivery query and the
    // friend_add / tag_added trigger loops all gate on is_active; without
    // this an entry route pointing at a deactivated campaign would still
    // instant-push its first step.
    if (!scenarioRow.is_active) return false;
    const steps = scenarioRow.steps;
    if (!steps[0]) return false;

    // Immediate only: delay-0 relative steps schedule at-or-before "now".
    // elapsed/absolute_time modes have offset/clock-time semantics — cron
    // owns those. Checked BEFORE claiming/enrolling so non-immediate
    // enrollments are left untouched.
    //
    // Conditions are evaluated here exactly like the cron's delivery path
    // (evaluateCondition). Previously the instant path pushed step 1
    // unconditionally, which leaked condition-gated steps (e.g. a tag_exists
    // "already answered → reward" step) to every friend on click. Now the
    // leading run of immediate steps is walked in order and the FIRST one
    // whose condition passes is delivered; steps it skips are the cron's
    // skip semantics (no message, no on_reach tag). If none passes, nothing
    // is claimed — the cron sweeps the skips on its own schedule.
    const enrolledAtJst = new Date(Date.now() + 9 * 60 * 60_000);
    const immediateSteps: typeof steps = [];
    for (const step of steps) {
      const scheduledAt = computeNextDeliveryAt(
        { delivery_mode: scenarioRow.delivery_mode ?? 'relative' },
        step,
        { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
      );
      if (scheduledAt.getTime() > enrolledAtJst.getTime()) break;
      immediateSteps.push(step);
    }
    if (immediateSteps.length === 0) return false;

    let picked: (typeof steps)[number] | null = null;
    for (const candidate of immediateSteps) {
      if (await evaluateCondition(db, friendId, candidate)) {
        picked = candidate;
        break;
      }
    }
    if (!picked) return false;
    const firstStep = picked;

    // Cooldown probe: a racing sender the claim protocol can't see may have
    // just pushed this exact step (click campaign vs follow webhook, double
    // LIFF load, …).
    const isRecentDuplicate = async (): Promise<boolean> => {
      const cutoff = toJstString(new Date(Date.now() - 60_000));
      const recent = await db
        .prepare(
          `SELECT 1 FROM messages_log
           WHERE friend_id = ? AND scenario_step_id = ?
             AND direction = 'outgoing' AND created_at > ?
           LIMIT 1`,
        )
        .bind(friendId, firstStep.id, cutoff)
        .first();
      return recent !== null;
    };

    const lookupEnrollment = () =>
      db
        .prepare(
          `SELECT id, current_step_order FROM friend_scenarios
           WHERE friend_id = ? AND scenario_id = ? AND status != 'completed'
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(friendId, scenarioId)
        .first<EnrollmentRef>();

    const advancePastFirstStep = async (enrollmentId: string) => {
      // The step AFTER the delivered one — firstStep may not be steps[0] when
      // condition evaluation skipped ahead.
      const nextStep = steps[steps.indexOf(firstStep) + 1];
      if (nextStep) {
        const next = computeNextDeliveryAt(
          { delivery_mode: scenarioRow.delivery_mode ?? 'relative' },
          nextStep,
          { enrolledAt: enrolledAtJst, previousDeliveredAt: enrolledAtJst, now: enrolledAtJst },
        );
        // `next` is already in the shifted-JST frame (its inputs were
        // Date.now()+9h), so serialize by relabeling — NOT toJstString(),
        // which would add the offset a second time and schedule step 2
        // nine hours late. Matches enrollFriendInScenario / the cron.
        await advanceFriendScenario(
          db,
          enrollmentId,
          firstStep.step_order,
          next.toISOString().slice(0, -1) + '+09:00',
        );
      } else {
        await completeFriendScenario(db, enrollmentId);
      }
    };

    const attachReachTag = async () => {
      if (!firstStep.on_reach_tag_id) return;
      try {
        await addTagToFriend(db, friendId, firstStep.on_reach_tag_id);
      } catch (err) {
        console.error(`[immediate-first-step] tag attach failed step=${firstStep.id}:`, err);
      }
    };

    // Which row to advance after a successful send (null = pure re-click
    // re-delivery: the row is already past step 1, leave it alone).
    let advanceTargetId: string | null = null;

    if (mode === 'once') {
      const enrollmentRow = options?.enrollment ?? (await lookupEnrollment());
      if (!enrollmentRow || enrollmentRow.current_step_order >= firstStep.step_order) return false;

      // Optimistic lock shared with the cron worker: whoever claims first
      // delivers step 1; the loser backs off. Closes the double-send window
      // between the enrollment INSERT and the post-push advance.
      const claimed = await claimFriendScenarioForDelivery(
        db,
        enrollmentRow.id,
        enrollmentRow.current_step_order,
      );
      if (!claimed) return false;
      claimedEnrollmentId = enrollmentRow.id;
      advanceTargetId = enrollmentRow.id;

      // Advance without pushing on a cooldown hit so the row is neither
      // stranded at step -1 nor re-delivered by the cron. The racer
      // delivered step 1, so the reach tag still applies.
      if (!options?.skipCooldown && (await isRecentDuplicate())) {
        await advancePastFirstStep(enrollmentRow.id);
        claimedEnrollmentId = null; // the advance released the claim
        await attachReachTag();
        return false;
      }
    } else {
      // every-click: cooldown FIRST, before enrolling. The LIFF entry points
      // fire on every page load (refresh, back-nav), not only on a fresh
      // tracked-link click. Enrolling before the cooldown check would leave
      // a fresh active step-0 row behind for the cron worker to pick up
      // (the partial UNIQUE on friend_scenarios is keyed
      // `WHERE status != 'completed'`, so completed runs don't block a new
      // INSERT).
      if (await isRecentDuplicate()) return false;

      // INSERT OR IGNORE — null on re-clicks (already enrolled), still push.
      const enrollment = await enrollFriendInScenario(db, friendId, scenarioId);
      const row = enrollment ?? (await lookupEnrollment());
      if (row && row.current_step_order < firstStep.step_order) {
        // This click owes step 1 to the enrollment — join the claim protocol
        // so the cron (the fresh row's next_delivery_at is already due) and
        // the follow-webhook path can't send it concurrently. A failed claim
        // means another sender is mid-delivery (or the row is paused): skip
        // rather than double-send.
        const claimed = await claimFriendScenarioForDelivery(db, row.id, row.current_step_order);
        if (!claimed) return false;
        claimedEnrollmentId = row.id;
        advanceTargetId = row.id;
      } else {
        // Pure re-click re-delivery. Re-probe the cooldown: the first probe
        // ran before the enroll round-trip, and a racing sender may have
        // logged its send in between.
        if (await isRecentDuplicate()) return false;
      }
    }

    const releaseClaim = async () => {
      if (!claimedEnrollmentId) return;
      await releaseClaimById(db, claimedEnrollmentId);
      claimedEnrollmentId = null;
    };

    // Re-read the friend after caller writes (linkFriendToUser / ref_code
    // UPDATE / line_account_id wiring) so {{uid}}, {{ref}}, and merged
    // metadata expand against the latest state.
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      await releaseClaim();
      return false;
    }

    // Independent D1 reads — resolve concurrently; this sits in front of the
    // reply-token send where latency eats into the token validity window.
    // ctxAccount is the caller-resolved channel (LIFF/OAuth flows), used for
    // both the push token and the tracked-link owner below.
    const [resolvedMeta, resolved, ctxAccount] = await Promise.all([
      resolveMetadata(db, { user_id: friend.user_id, metadata: friend.metadata }),
      resolveStepContent(db, firstStep),
      ctx.accountChannelId ? getLineAccountByChannelId(db, ctx.accountChannelId) : null,
    ]);
    const expanded = expandVariables(
      resolved.messageContent,
      { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1],
      ctx.workerUrl,
      resolved.messageType,
    );
    // Same decoration pipeline as the cron (processStepDeliveries) via the
    // shared helper. Link owner: the friend's own account, else the
    // caller-resolved channel — LIFF/OAuth entry points run BEFORE the follow
    // webhook wires friend.line_account_id, and an owner-less link would send
    // that account's friends through the global LIFF consent screen.
    const decorated = await decorateForFriendPush(
      db,
      resolved.messageType,
      expanded,
      ctx.workerUrl,
      { lineAccountId: friend.line_account_id ?? ctxAccount?.id ?? null, friendId },
    );
    const sentMessage = buildMessage(decorated.messageType, decorated.content);

    try {
      if (options?.reply) {
        await options.reply.client.replyMessage(options.reply.replyToken, [sentMessage]);
      } else {
        const pushTarget = options?.targetLineUserId ?? friend.line_user_id;
        if (!pushTarget) {
          // Can't push from here — hand the claim back so the cron retries.
          await releaseClaim();
          return false;
        }
        // Token: caller-supplied account channel → friend's own account → env default.
        let accessToken = ctx.defaultAccessToken;
        if (ctx.accountChannelId) {
          if (ctxAccount?.channel_access_token) accessToken = ctxAccount.channel_access_token;
        } else if (friend.line_account_id) {
          const acct = await getLineAccountById(db, friend.line_account_id);
          if (acct?.channel_access_token) accessToken = acct.channel_access_token;
        }
        const lineClient = new LineClient(accessToken);
        await lineClient.pushMessage(pushTarget, [sentMessage]);
      }
    } catch (err) {
      // The message never left LINE's API — release so the cron retries on
      // schedule.
      console.error('[immediate-first-step] send failed, releasing claim:', err);
      await releaseClaim();
      return false;
    }
    sent = true;
    settleAfterSend = async () => {
      if (advanceTargetId) {
        await advancePastFirstStep(advanceTargetId);
        claimedEnrollmentId = null; // the advance released the claim
        await attachReachTag();
      }
    };

    // Log what was actually delivered (post buildMessage normalization) so
    // the cooldown above sees it on subsequent calls and the dashboard chat
    // view mirrors LINE 1:1. delivery_type mirrors the send channel.
    const logPayload = messageToLogPayload(sentMessage);
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, delivery_type, source, template_id_at_send, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, ?, ?, 'scenario', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        friendId,
        logPayload.messageType,
        logPayload.content,
        firstStep.id,
        options?.reply ? 'reply' : null,
        resolved.templateIdAtSend,
        jstNow(),
      )
      .run();

    await settleAfterSend();
    settleAfterSend = null;
    return true;
  } catch (err) {
    console.error('[immediate-first-step] push failed:', err);
    try {
      if (sent && settleAfterSend) {
        // The message went out but logging/advancing threw — advance anyway
        // (best effort) so the cron cannot re-deliver step 1.
        await settleAfterSend();
      } else if (claimedEnrollmentId) {
        // Nothing was sent — hand the claim back now instead of leaving the
        // row in 'delivering' until the stuck-delivery sweep frees it.
        await releaseClaimById(db, claimedEnrollmentId);
      }
    } catch (settleErr) {
      console.error('[immediate-first-step] post-failure settle failed:', settleErr);
    }
    return sent;
  }
}

async function releaseClaimById(db: D1Database, enrollmentId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE friend_scenarios SET status = 'active', updated_at = ?
       WHERE id = ? AND status = 'delivering'`,
    )
    .bind(jstNow(), enrollmentId)
    .run();
}
