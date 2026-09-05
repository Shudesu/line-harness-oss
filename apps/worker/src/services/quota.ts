/**
 * Generic usage quotas for a deployment. All limits are opt-in via env vars;
 * unset/invalid = unlimited, which keeps existing deployments unchanged.
 * When a limit is exceeded, bulk sends (broadcasts, scenario steps, segment
 * sends) are paused — 1:1 chat, auto-replies and reminders keep working.
 */

export type QuotaEnv = {
  QUOTA_FRIENDS_MAX?: string;
  QUOTA_MONTHLY_MESSAGES_MAX?: string;
  QUOTA_NOTICE_URL?: string;
};

function posInt(v: string | undefined): number {
  const n = Number((v ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function quotaConfig(env: QuotaEnv): {
  friendsMax: number;
  monthlyMessagesMax: number;
  noticeUrl: string | null;
} {
  const url = (env.QUOTA_NOTICE_URL ?? '').trim();
  return {
    friendsMax: posInt(env.QUOTA_FRIENDS_MAX),
    monthlyMessagesMax: posInt(env.QUOTA_MONTHLY_MESSAGES_MAX),
    noticeUrl: url === '' ? null : url,
  };
}

export function quotaEnabled(env: QuotaEnv): boolean {
  const c = quotaConfig(env);
  return c.friendsMax > 0 || c.monthlyMessagesMax > 0;
}

/**
 * Start of the current month in the exact created_at format (JST, T-separated,
 * 3-digit millis, no timezone suffix — see retentionCutoff in log-retention.ts).
 */
export function monthStartJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return jst.toISOString().slice(0, 7) + '-01T00:00:00.000';
}

/** yyyyMMdd of the JST day `daysAgo` days in the past (0 = today). */
export function jstYyyyMmDd(daysAgo: number, now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600_000 - daysAgo * 86_400_000);
  return jst.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Per-account count of messages sent this JST month, approximating LINE's
 * official 「配信済みメッセージ数」: push-type messages_log rows (joined through
 * friends.line_account_id — legacy rows carry no ml.line_account_id) plus the
 * success_count of all-target broadcasts sent through LINE's broadcast API,
 * which write no per-recipient messages_log rows (same term as getQuotaUsage
 * below). Broadcast rows with a NULL line_account_id (single-account era) are
 * deliberately excluded — they cannot be attributed to one account.
 *
 * ⚠️ 概算 (上振れ側): all-target broadcast の success_count は送信直前の
 * `line_account_id = ? OR IS NULL` COUNT のスナップショットで、マルチアカウント
 * 運用では共有 legacy NULL プールが各アカウントの配信に重複計上される
 * (broadcast.ts の followerRow コメント参照 — 制限用途では over-count が安全側)。
 * 正確な消費量は同じ delivery-health 応答の LINE 公式 consumption を見ること。
 *
 * Single definition shared by GET /api/line-accounts (stats.messagesThisMonth)
 * and GET /api/line-accounts/delivery-health so the two dashboard numbers
 * never disagree.
 */
export async function countAccountMonthlyMessages(
  db: D1Database,
  lineAccountId: string,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = monthStartJst(now);
  const [logRow, bcRow] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) as count FROM messages_log ml
          INNER JOIN friends f ON f.id = ml.friend_id
          WHERE ml.direction = 'outgoing'
            AND (ml.delivery_type IS NULL OR ml.delivery_type = 'push')
            AND ml.created_at >= ? AND f.line_account_id = ?`,
      )
      .bind(cutoff, lineAccountId)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(success_count), 0) as count FROM broadcasts
          WHERE target_type = 'all'
            AND line_request_id IS NOT NULL
            AND sent_at >= ? AND line_account_id = ?`,
      )
      .bind(cutoff, lineAccountId)
      .first<{ count: number }>(),
  ]);
  return (logRow?.count ?? 0) + (bcRow?.count ?? 0);
}

export type QuotaUsage = {
  friends: { used: number; max: number };
  monthlyMessages: { used: number; max: number };
  exceeded: boolean;
  noticeUrl: string | null;
};

export async function getQuotaUsage(
  db: D1Database,
  env: QuotaEnv,
  now: Date = new Date(),
): Promise<QuotaUsage> {
  const c = quotaConfig(env);
  let friendsUsed = 0;
  let monthlyUsed = 0;
  if (c.friendsMax > 0) {
    const row = await db
      .prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1')
      .first<{ count: number }>();
    friendsUsed = row?.count ?? 0;
  }
  if (c.monthlyMessagesMax > 0) {
    // Same definition as the per-account monthly stat: outgoing push only
    // (reply-API messages are excluded), from the start of the JST month.
    const row = await db
      .prepare(
        `SELECT COUNT(*) as count FROM messages_log
          WHERE direction = 'outgoing'
            AND (delivery_type IS NULL OR delivery_type = 'push')
            AND created_at >= ?`,
      )
      .bind(monthStartJst(now))
      .first<{ count: number }>();
    monthlyUsed = row?.count ?? 0;
    // All-target sends that went through LINE's broadcast API write no
    // per-recipient messages_log rows, so they would be invisible to the
    // count above. Those broadcasts are the only ones with a non-null
    // line_request_id, and processBroadcastSend records the follower count
    // as success_count at send time — add that in. sent_at carries a +09:00
    // suffix but shares the JST wall-clock prefix with the cutoff, so the
    // lexicographic comparison is still safe.
    const bc = await db
      .prepare(
        `SELECT COALESCE(SUM(success_count), 0) as count FROM broadcasts
          WHERE target_type = 'all'
            AND line_request_id IS NOT NULL
            AND sent_at >= ?`,
      )
      .bind(monthStartJst(now))
      .first<{ count: number }>();
    monthlyUsed += bc?.count ?? 0;
  }
  // Boundary is deliberately asymmetric: at exactly friendsMax friends the
  // deployment is still fine (nothing new is being added by a send), while at
  // exactly monthlyMessagesMax sends the next message would go over.
  const exceeded =
    (c.friendsMax > 0 && friendsUsed > c.friendsMax) ||
    (c.monthlyMessagesMax > 0 && monthlyUsed >= c.monthlyMessagesMax);
  return {
    friends: { used: friendsUsed, max: c.friendsMax },
    monthlyMessages: { used: monthlyUsed, max: c.monthlyMessagesMax },
    exceeded,
    noticeUrl: c.noticeUrl,
  };
}

/**
 * Cheap audience estimate for the monthly usage guard: a single COUNT for
 * all/tag targets. Returns null when no inexpensive count exists
 * (multi-account-dedup needs the full preview); callers then fall back to the
 * current-value check plus the queue-side per-batch re-check.
 */
export async function estimateSendAudience(
  db: D1Database,
  broadcast: { target_type: string; target_tag_id?: string | null },
): Promise<number | null> {
  if (broadcast.target_type === 'tag') {
    if (!broadcast.target_tag_id) return null;
    // Deliberately NO account filter here, even for an account-bound
    // broadcast: the actual tag send path (getFriendsByTag in broadcast.ts)
    // messages every following friend with the tag regardless of account.
    // The estimate must mirror what will really be sent — an account-filtered
    // count would undercount and let a send slip past the monthly limit.
    const row = await db
      .prepare(
        `SELECT COUNT(*) as count FROM friends
          WHERE is_following = 1
            AND EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = friends.id AND ft.tag_id = ?)`,
      )
      .bind(broadcast.target_tag_id)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }
  if (broadcast.target_type !== 'all') return null;
  const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
  const where: string[] = ['is_following = 1'];
  const binds: unknown[] = [];
  if (accountId) {
    // Include legacy rows with a NULL line_account_id: they still receive the
    // account's send, and for a limiting feature counting them (possibly
    // toward several accounts) errs on the safe, over-counting side.
    where.push('(line_account_id = ? OR line_account_id IS NULL)');
    binds.push(accountId);
  }
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM friends WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Audience COUNT of a queued (tag-marker) tag send: the exact population the
 * queue executor delivers to. The marker carries only a tag_exists rule, so
 * there is deliberately NO is_following filter — unfollowed tagged rows are
 * part of the send (and log) population — and the account filter is the same
 * strict equality the executor injects. Returns null without a tag id.
 */
export async function queuedTagAudienceCount(
  db: D1Database,
  broadcast: { target_type: string; target_tag_id?: string | null },
): Promise<number | null> {
  if (!broadcast.target_tag_id) return null;
  const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
  const where: string[] = [
    'EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)',
  ];
  const binds: unknown[] = [broadcast.target_tag_id];
  if (accountId) {
    where.unshift('f.line_account_id = ?');
    binds.unshift(accountId);
  }
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM friends f WHERE ${where.join(' AND ')}`)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * WHERE clause + binds of a personalized (per-recipient) send's audience: the
 * exact population the queued personalized path delivers to — account-filtered
 * (strict equality, matching the executor's account filter), optionally
 * tag-filtered. Shared by the /send route (audience + missing-name query) and
 * the scheduled pre-claim guard so the two definitions never drift.
 * Returns null when a tag target has no tag id.
 */
export function personalizedAudienceFilter(
  broadcast: { target_type: string; target_tag_id?: string | null },
): { where: string; binds: unknown[] } | null {
  const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
  const where: string[] = ['f.is_following = 1'];
  const binds: unknown[] = [];
  if (accountId) {
    where.push('f.line_account_id = ?');
    binds.push(accountId);
  }
  if (broadcast.target_type === 'tag') {
    if (!broadcast.target_tag_id) return null;
    where.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
    binds.push(broadcast.target_tag_id);
  }
  return { where: where.join(' AND '), binds };
}

/** Exact audience COUNT of a personalized send (see personalizedAudienceFilter). */
export async function personalizedAudienceCount(
  db: D1Database,
  broadcast: { target_type: string; target_tag_id?: string | null },
): Promise<number | null> {
  const filter = personalizedAudienceFilter(broadcast);
  if (!filter) return null;
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM friends f WHERE ${filter.where}`)
    .bind(...filter.binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * True when sending `estimate` more messages would cross the monthly limit.
 * A null estimate (no cheap audience count available) or an empty audience
 * never blocks here — the cron-side batch re-check still bounds the overshoot.
 */
export function wouldExceedMonthlyQuota(usage: QuotaUsage, estimate: number | null): boolean {
  return (
    usage.monthlyMessages.max > 0 &&
    estimate !== null &&
    estimate > 0 &&
    usage.monthlyMessages.used + estimate > usage.monthlyMessages.max
  );
}

/**
 * Start the bulk-send jobs of one scheduled tick.
 *
 * While a monthly send limit is active the jobs run serially in the given
 * order: each job reads the usage tally when it starts, so in parallel none
 * of them sees the others' sends of the same tick and together they could
 * cross the limit. A serial-mode job failure is logged and does not stop the
 * jobs after it (same per-job isolation as the parallel path, where
 * Promise.allSettled absorbs rejections).
 *
 * Without a monthly limit every job starts immediately (previous behavior,
 * fully parallel). Either way the returned promises are safe to await
 * together with unrelated jobs.
 */
export function startBulkSendJobs(
  env: QuotaEnv,
  tasks: Array<() => Promise<unknown>>,
): Promise<unknown>[] {
  if (quotaConfig(env).monthlyMessagesMax === 0) {
    return tasks.map((t) => t());
  }
  return [
    (async () => {
      for (const t of tasks) {
        try {
          await t();
        } catch (err) {
          console.error('bulk send job failed:', err);
        }
      }
    })(),
  ];
}

export async function isQuotaExceeded(
  db: D1Database,
  env: QuotaEnv,
  now: Date = new Date(),
): Promise<boolean> {
  if (!quotaEnabled(env)) return false;
  return (await getQuotaUsage(db, env, now)).exceeded;
}
