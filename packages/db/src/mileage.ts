import { jstNow } from './utils.js';

export const DEFAULT_MILEAGE_PROGRAM_ID = 'default';

/**
 * Bootstrap files contain schema objects but not seed rows, so lazily ensure the
 * built-in program before any default-wallet operation. The migration also
 * seeds it; INSERT OR IGNORE keeps both deployment paths safe.
 */
export async function ensureDefaultMileageProgram(db: D1Database): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_programs
         (id, code, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .bind(
      DEFAULT_MILEAGE_PROGRAM_ID,
      DEFAULT_MILEAGE_PROGRAM_ID,
      'Harnessマイル',
      now,
      now,
    )
    .run();
}

async function ensureBuiltInProgram(db: D1Database, programId: string): Promise<void> {
  if (programId === DEFAULT_MILEAGE_PROGRAM_ID) {
    await ensureDefaultMileageProgram(db);
  }
}

export type MileageEntryType =
  | 'grant'
  | 'reversal'
  | 'spend'
  | 'expiration'
  | 'adjustment';
export type MileageEntryStatus = 'pending' | 'available' | 'void';

export interface EngagementEvent {
  id: string;
  program_id: string;
  idempotency_key: string;
  event_type: string;
  source: string;
  source_event_id: string | null;
  actor_user_id: string | null;
  actor_friend_id: string | null;
  subject_user_id: string | null;
  subject_friend_id: string | null;
  identity_provider: string | null;
  identity_subject: string | null;
  metadata: string | null;
  occurred_at: string;
  created_at: string;
}

export interface MileageLedgerEntry {
  id: string;
  program_id: string;
  beneficiary_user_id: string | null;
  beneficiary_friend_id: string | null;
  engagement_event_id: string | null;
  mileage_rule_id: string | null;
  entry_type: MileageEntryType;
  status: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  source_event_id: string | null;
  idempotency_key: string;
  reverses_entry_id: string | null;
  metadata: string | null;
  occurred_at: string;
  created_at: string;
}

export interface RecordEngagementEventInput {
  programId?: string;
  idempotencyKey: string;
  eventType: string;
  source: string;
  sourceEventId?: string | null;
  actorUserId?: string | null;
  actorFriendId?: string | null;
  subjectUserId?: string | null;
  subjectFriendId?: string | null;
  identityProvider?: string | null;
  identitySubject?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

/**
 * Persist one normalized user action exactly once.
 *
 * Every channel (LIFF, webinar, Instagram, X, etc.) can call this same entry
 * point. `idempotencyKey` must be stable for the upstream action so webhook or
 * API retries never duplicate either the event or its eventual mileage grant.
 */
export async function recordEngagementEvent(
  db: D1Database,
  input: RecordEngagementEventInput,
): Promise<EngagementEvent> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const programId = input.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);

  await db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events
         (id, program_id, idempotency_key, event_type, source, source_event_id,
          actor_user_id, actor_friend_id, subject_user_id, subject_friend_id,
          identity_provider, identity_subject, metadata, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      programId,
      input.idempotencyKey,
      input.eventType,
      input.source,
      input.sourceEventId ?? null,
      input.actorUserId ?? null,
      input.actorFriendId ?? null,
      input.subjectUserId ?? null,
      input.subjectFriendId ?? null,
      input.identityProvider ?? null,
      input.identitySubject ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.occurredAt ?? now,
      now,
    )
    .run();

  const event = await db
    .prepare(
      `SELECT * FROM engagement_events
        WHERE program_id = ? AND idempotency_key = ?`,
    )
    .bind(programId, input.idempotencyKey)
    .first<EngagementEvent>();
  if (!event) throw new Error('Failed to record engagement event');
  return event;
}

export interface EnqueueMileageEventInput {
  eventType: string;
  source: string;
  sourceEventId: string;
  friendId: string;
  subjectKey?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

/** Record an action and enqueue its mileage projection without blocking it. */
export async function enqueueMileageEvent(
  db: D1Database,
  input: EnqueueMileageEventInput,
): Promise<EngagementEvent> {
  const friend = await db
    .prepare(`SELECT id, user_id FROM friends WHERE id = ?`)
    .bind(input.friendId)
    .first<{ id: string; user_id: string | null }>();
  if (!friend) throw new Error(`Mileage friend not found: ${input.friendId}`);

  const now = jstNow();
  const event = await recordEngagementEvent(db, {
    idempotencyKey: `${input.source}:${input.eventType}:${input.sourceEventId}`,
    eventType: input.eventType,
    source: input.source,
    sourceEventId: input.sourceEventId,
    actorUserId: friend.user_id,
    actorFriendId: friend.id,
    metadata: {
      ...(input.metadata ?? {}),
      ...(input.subjectKey ? { subjectKey: input.subjectKey } : {}),
    },
    occurredAt: input.occurredAt ?? now,
  });

  await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_event_queue
         (engagement_event_id, status, attempts, available_at, created_at, updated_at)
       VALUES (?, 'pending', 0, ?, ?, ?)`,
    )
    .bind(event.id, now, now, now)
    .run();
  return event;
}

export interface PostMileageEntryInput {
  programId?: string;
  beneficiaryUserId?: string | null;
  beneficiaryFriendId?: string | null;
  engagementEventId?: string | null;
  mileageRuleId?: string | null;
  entryType: MileageEntryType;
  status?: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  sourceEventId?: string | null;
  idempotencyKey: string;
  reversesEntryId?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

/** Add one immutable ledger entry exactly once. Existing entries are returned. */
export async function postMileageEntry(
  db: D1Database,
  input: PostMileageEntryInput,
): Promise<MileageLedgerEntry> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new Error('Mileage amount must be a non-zero integer');
  }
  if (!input.beneficiaryUserId && !input.beneficiaryFriendId) {
    throw new Error('Mileage beneficiary is required');
  }

  const id = crypto.randomUUID();
  const now = jstNow();
  const programId = input.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);
  await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_ledger
         (id, program_id, beneficiary_user_id, beneficiary_friend_id,
          engagement_event_id, mileage_rule_id, entry_type, status, amount, reason, source,
          source_event_id, idempotency_key, reverses_entry_id, metadata,
          occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      programId,
      input.beneficiaryUserId ?? null,
      input.beneficiaryFriendId ?? null,
      input.engagementEventId ?? null,
      input.mileageRuleId ?? null,
      input.entryType,
      input.status ?? 'available',
      input.amount,
      input.reason,
      input.source,
      input.sourceEventId ?? null,
      input.idempotencyKey,
      input.reversesEntryId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.occurredAt ?? now,
      now,
    )
    .run();

  const entry = await db
    .prepare(
      `SELECT * FROM mileage_ledger
        WHERE program_id = ? AND idempotency_key = ?`,
    )
    .bind(programId, input.idempotencyKey)
    .first<MileageLedgerEntry>();
  if (!entry) throw new Error('Failed to post mileage entry');
  return entry;
}

export interface MileageSummary {
  programId: string;
  programName: string;
  available: number;
  pending: number;
  lifetimeEarned: number;
  spent: number;
}

const FRIEND_WALLET_SCOPE_SQL = `(
  ml.beneficiary_friend_id = ?
  OR (
    identity.user_id IS NOT NULL
    AND (
      ml.beneficiary_user_id = identity.user_id
      OR ml.beneficiary_friend_id IN (
        SELECT linked.id FROM friends linked WHERE linked.user_id = identity.user_id
      )
    )
  )
)`;

/**
 * Resolve a wallet through friends.user_id when available. This makes balances
 * follow the same person across multiple LINE accounts without rewriting old
 * ledger rows; an unlinked friend still has a safe friend-scoped wallet.
 */
export async function getMileageSummaryForFriend(
  db: D1Database,
  friendId: string,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
): Promise<MileageSummary> {
  await ensureBuiltInProgram(db, programId);
  const row = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       )
       SELECT mp.name AS program_name,
              COALESCE(SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END), 0) AS available,
              COALESCE(SUM(CASE WHEN ml.status = 'pending' THEN ml.amount ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN ml.entry_type = 'grant' AND ml.amount > 0
                                THEN ml.amount ELSE 0 END), 0) AS lifetime_earned,
              COALESCE(-SUM(CASE WHEN ml.entry_type = 'spend' AND ml.amount < 0
                                 THEN ml.amount ELSE 0 END), 0) AS spent
         FROM mileage_programs mp
         LEFT JOIN identity ON 1 = 1
         LEFT JOIN mileage_ledger ml
           ON ml.program_id = mp.id
          AND ${FRIEND_WALLET_SCOPE_SQL}
        WHERE mp.id = ?
        GROUP BY mp.id, mp.name`,
    )
    .bind(friendId, friendId, programId)
    .first<{
      program_name: string;
      available: number;
      pending: number;
      lifetime_earned: number;
      spent: number;
    }>();

  if (!row) throw new Error(`Mileage program not found: ${programId}`);
  return {
    programId,
    programName: row.program_name,
    available: Number(row.available),
    pending: Number(row.pending),
    lifetimeEarned: Number(row.lifetime_earned),
    spent: Number(row.spent),
  };
}

export interface MileageHistoryItem {
  id: string;
  entryType: MileageEntryType;
  status: MileageEntryStatus;
  amount: number;
  reason: string;
  source: string;
  sourceEventId: string | null;
  occurredAt: string;
}

export async function getMileageHistoryForFriend(
  db: D1Database,
  friendId: string,
  options: { programId?: string; limit?: number } = {},
): Promise<MileageHistoryItem[]> {
  const programId = options.programId ?? DEFAULT_MILEAGE_PROGRAM_ID;
  await ensureBuiltInProgram(db, programId);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const result = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       )
       SELECT ml.id, ml.entry_type, ml.status, ml.amount, ml.reason,
              ml.source, ml.source_event_id, ml.occurred_at
         FROM mileage_ledger ml
         LEFT JOIN identity ON 1 = 1
        WHERE ml.program_id = ?
          AND ${FRIEND_WALLET_SCOPE_SQL}
        ORDER BY ml.occurred_at DESC, ml.created_at DESC, ml.id DESC
        LIMIT ?`,
    )
    .bind(friendId, programId, friendId, limit)
    .all<{
      id: string;
      entry_type: MileageEntryType;
      status: MileageEntryStatus;
      amount: number;
      reason: string;
      source: string;
      source_event_id: string | null;
      occurred_at: string;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    entryType: row.entry_type,
    status: row.status,
    amount: row.amount,
    reason: row.reason,
    source: row.source,
    sourceEventId: row.source_event_id,
    occurredAt: row.occurred_at,
  }));
}

export interface MileageSelfInsights {
  /** Number of LINE Official Accounts currently linked to this person. */
  accountCount: number;
  /** Non-void mileage grants, useful as a simple engagement counter. */
  rewardedActions: number;
  /** Available miles earned because an introduced friend took a quality action. */
  referralMiles: number;
  /** Distinct introduced people who produced at least one quality reward. */
  qualityReferralCount: number;
  lastEarnedAt: string | null;
}

export interface MileageEarningOpportunity {
  id: string;
  type: 'webinar' | 'friend_add';
  title: string;
  description: string;
  rewardMiles: number;
  nextRewardMiles: number;
  progressPercent: number;
  ctaLabel: string;
  url: string;
  targetAccountId?: string;
  completed?: boolean;
  mileageStatus?: 'credited' | 'pending' | 'waiting';
  creditedMiles?: number;
}

/**
 * Personal mileage-page counters for one verified friend.
 *
 * The wallet scope deliberately matches getMileageSummaryForFriend: once a
 * friend is linked to a canonical users.id, activity from every connected LINE
 * Official Account is shown as one wallet. Unlinked friends remain isolated to
 * their own friend row.
 */
export async function getMileageSelfInsights(
  db: D1Database,
  friendId: string,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
): Promise<MileageSelfInsights> {
  await ensureBuiltInProgram(db, programId);
  const row = await db
    .prepare(
      `WITH identity AS (
         SELECT user_id FROM friends WHERE id = ?
       ), friend_scope AS (
         SELECT f.id, f.line_account_id
           FROM friends f
           LEFT JOIN identity ON 1 = 1
          WHERE f.id = ?
             OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id)
       )
       SELECT (SELECT COUNT(DISTINCT line_account_id) FROM friend_scope) AS account_count,
              COUNT(CASE
                WHEN ml.entry_type = 'grant' AND ml.status != 'void' THEN 1
                ELSE NULL END) AS rewarded_actions,
              COALESCE(SUM(CASE
                WHEN ml.status = 'available'
                 AND (ml.source = 'tag_referral'
                      OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
                THEN ml.amount ELSE 0 END), 0) AS referral_miles,
              COUNT(DISTINCT CASE
                WHEN ml.entry_type = 'grant'
                 AND ml.status != 'void'
                 AND (ml.source = 'tag_referral'
                      OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
                THEN COALESCE(json_extract(ml.metadata, '$.referredUserId'),
                              json_extract(ml.metadata, '$.referredFriendId'))
                ELSE NULL END) AS quality_referral_count,
              MAX(CASE
                WHEN ml.entry_type = 'grant' AND ml.status != 'void'
                THEN ml.occurred_at ELSE NULL END) AS last_earned_at
         FROM mileage_ledger ml
         LEFT JOIN identity ON 1 = 1
        WHERE ml.program_id = ?
          AND ${FRIEND_WALLET_SCOPE_SQL}`,
    )
    .bind(friendId, friendId, programId, friendId)
    .first<{
      account_count: number;
      rewarded_actions: number;
      referral_miles: number;
      quality_referral_count: number;
      last_earned_at: string | null;
    }>();

  return {
    accountCount: Number(row?.account_count ?? 0),
    rewardedActions: Number(row?.rewarded_actions ?? 0),
    referralMiles: Number(row?.referral_miles ?? 0),
    qualityReferralCount: Number(row?.quality_referral_count ?? 0),
    lastEarnedAt: row?.last_earned_at ?? null,
  };
}

/**
 * Build actionable, person-specific ways to earn more mileage.
 *
 * The first opportunity provider is the auto-webinar system. It compares the
 * person's best viewing position (across linked friend rows) with the active
 * mileage rules, then only returns webinars that still have an attainable
 * reward. The returned LIFF URL always uses the webinar's own LINE account.
 */
export async function getMileageEarningOpportunitiesForFriend(
  db: D1Database,
  friendId: string,
  options: { limit?: number; now?: string } = {},
): Promise<MileageEarningOpportunity[]> {
  const limit = Math.min(10, Math.max(1, options.limit ?? 10));
  const now = options.now ?? jstNow();
  const eventTypes = [
    'webinar_watch_5m',
    'webinar_watch_15m',
    'webinar_completed',
    'webinar_cta_clicked',
  ] as const;

  const [rulesResult, webinarsResult, accountsResult, multiplier] = await Promise.all([
    db
      .prepare(
        `SELECT event_type, source, amount, conditions
           FROM mileage_rules
          WHERE program_id = ?
            AND event_type IN ('friend_registered', ?, ?, ?, ?)
            AND is_active = 1
            AND (conditions IS NULL
                 OR COALESCE(json_extract(conditions, '$.beneficiary'), 'actor') = 'actor')
            AND (valid_from IS NULL OR valid_from <= ?)
            AND (valid_until IS NULL OR valid_until >= ?)
          ORDER BY created_at ASC, id ASC`,
      )
      .bind(
        DEFAULT_MILEAGE_PROGRAM_ID,
        ...eventTypes,
        now,
        now,
      )
      .all<{ event_type: string; source: string | null; amount: number; conditions: string | null }>(),
    db
      .prepare(
        `WITH identity AS (
           SELECT user_id, line_account_id FROM friends WHERE id = ?
         ), friend_scope AS (
           SELECT f.id
             FROM friends f
             LEFT JOIN identity ON 1 = 1
            WHERE f.id = ?
               OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id)
         )
         SELECT w.id, w.title, w.slug, w.duration_seconds, w.updated_at,
                la.liff_id,
                COALESCE(MAX(v.last_position_seconds), 0) AS max_position_seconds,
                MAX(CASE WHEN v.cta_clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS cta_clicked,
                MAX(CASE WHEN wc.id IS NOT NULL OR w.cta_json IS NOT NULL THEN 1 ELSE 0 END) AS has_cta
           FROM webinars w
           JOIN identity ON w.account_id = identity.line_account_id
           JOIN line_accounts la ON la.id = w.account_id
           LEFT JOIN webinar_viewers v
             ON v.webinar_id = w.id
            AND v.friend_id IN (SELECT id FROM friend_scope)
           LEFT JOIN webinar_ctas wc ON wc.webinar_id = w.id
          WHERE w.status = 'active'
            AND w.duration_seconds > 0
            AND la.is_active = 1
            AND la.liff_id IS NOT NULL
            AND la.liff_id != ''
          GROUP BY w.id, w.title, w.slug, w.duration_seconds, w.updated_at, la.liff_id
          ORDER BY w.updated_at DESC, w.id ASC`,
      )
      .bind(friendId, friendId)
      .all<{
        id: string;
        title: string;
        slug: string;
        duration_seconds: number;
        updated_at: string;
        liff_id: string;
        max_position_seconds: number;
        cta_clicked: number;
        has_cta: number;
      }>(),
    db
      .prepare(
        `WITH identity AS (
           SELECT user_id FROM friends WHERE id = ?
         ), scoped_friends AS (
           SELECT f.id, f.line_account_id, f.is_following
             FROM friends f
             LEFT JOIN identity ON 1 = 1
            WHERE f.line_account_id IS NOT NULL
              AND (f.id = ?
                   OR (identity.user_id IS NOT NULL AND f.user_id = identity.user_id))
         )
         SELECT la.id, la.name, la.liff_id, la.display_order,
                EXISTS(
                  SELECT 1 FROM scoped_friends sf
                   WHERE sf.line_account_id = la.id AND sf.is_following = 1
                ) AS is_registered,
                COALESCE((
                  SELECT SUM(ml.amount)
                    FROM scoped_friends sf
                    JOIN engagement_events ee
                      ON ee.actor_friend_id = sf.id
                     AND ee.event_type = 'friend_registered'
                     AND ee.source = 'line_relationship'
                    JOIN mileage_ledger ml
                      ON ml.engagement_event_id = ee.id
                     AND ml.program_id = 'default'
                     AND ml.mileage_rule_id = 'builtin-friend-registered'
                     AND ml.entry_type = 'grant'
                     AND ml.status = 'available'
                   WHERE sf.line_account_id = la.id
                ), 0) AS credited_miles,
                COALESCE((
                  SELECT SUM(ml.amount)
                    FROM scoped_friends sf
                    JOIN engagement_events ee
                      ON ee.actor_friend_id = sf.id
                     AND ee.event_type = 'friend_registered'
                     AND ee.source = 'line_relationship'
                    JOIN mileage_ledger ml
                      ON ml.engagement_event_id = ee.id
                     AND ml.program_id = 'default'
                     AND ml.mileage_rule_id = 'builtin-friend-registered'
                     AND ml.entry_type = 'grant'
                     AND ml.status = 'pending'
                   WHERE sf.line_account_id = la.id
                ), 0) AS pending_miles
           FROM line_accounts la
          WHERE la.is_active = 1
            AND la.liff_id IS NOT NULL
            AND la.liff_id != ''
          ORDER BY la.display_order ASC, la.created_at ASC, la.id ASC`,
      )
      .bind(friendId, friendId)
      .all<{
        id: string;
        name: string;
        liff_id: string;
        display_order: number;
        is_registered: number;
        credited_miles: number;
        pending_miles: number;
      }>(),
    resolveMileageMultiplier(db, friendId, now),
  ]);

  const amounts = new Map<string, number>();
  for (const rule of rulesResult.results) {
    const sourceMatches = rule.event_type === 'friend_registered'
      ? rule.source === null || rule.source === 'line_relationship'
      : rule.source === null || rule.source === 'webinar';
    if (!sourceMatches) continue;
    let conditions: MileageRuleConditions = {};
    if (rule.conditions) {
      try { conditions = JSON.parse(rule.conditions) as MileageRuleConditions; } catch { conditions = {}; }
    }
    const adjustedAmount = conditions.ignoreMultiplier
      ? Number(rule.amount)
      : Math.max(1, Math.round((Number(rule.amount) * multiplier.bps) / 10000));
    amounts.set(rule.event_type, (amounts.get(rule.event_type) ?? 0) + adjustedAmount);
  }
  const opportunities: Array<MileageEarningOpportunity & { secondsToNext: number }> = [];

  const friendAddReward = amounts.get('friend_registered') ?? 0;
  if (friendAddReward > 0) {
    for (const account of accountsResult.results) {
      const completed = Boolean(account.is_registered);
      const creditedMiles = Number(account.credited_miles ?? 0);
      const pendingMiles = Number(account.pending_miles ?? 0);
      const mileageStatus = !completed
        ? undefined
        : creditedMiles > 0
          ? 'credited'
          : pendingMiles > 0
            ? 'pending'
            : 'waiting';
      const description = !completed
        ? `友だち追加で +${friendAddReward} mile。追加後は4アカウント分のマイルを合算できます`
        : mileageStatus === 'credited'
          ? `友だち登録済み・+${creditedMiles} mile 加算済み`
          : mileageStatus === 'pending'
            ? `友だち登録済み・+${pendingMiles} mile 確定待ち`
            : '友だち登録済み・マイルは定期集計で反映されます';
      opportunities.push({
        id: `friend-add:${account.id}`,
        type: 'friend_add',
        title: completed ? account.name : `${account.name}を友だち追加`,
        description,
        rewardMiles: friendAddReward,
        nextRewardMiles: completed ? 0 : friendAddReward,
        progressPercent: completed ? 100 : 0,
        ctaLabel: completed ? '登録済み' : '友だち追加する',
        url: `https://liff.line.me/${account.liff_id}/?page=affiliate&liffId=${encodeURIComponent(account.liff_id)}`,
        targetAccountId: account.id,
        completed,
        mileageStatus,
        creditedMiles,
        secondsToNext: 0,
      });
    }
  }

  for (const webinar of webinarsResult.results) {
    const duration = Number(webinar.duration_seconds);
    const position = Math.max(0, Math.min(duration, Number(webinar.max_position_seconds)));
    const milestones = [
      ...(duration >= 300 && (amounts.get('webinar_watch_5m') ?? 0) > 0
        ? [{ seconds: 300, amount: amounts.get('webinar_watch_5m')!, label: '5分視聴' }]
        : []),
      ...(duration >= 900 && (amounts.get('webinar_watch_15m') ?? 0) > 0
        ? [{ seconds: 900, amount: amounts.get('webinar_watch_15m')!, label: '15分視聴' }]
        : []),
      ...((amounts.get('webinar_completed') ?? 0) > 0
        ? [{
            seconds: Math.max(1, Math.floor(duration * 0.9)),
            amount: amounts.get('webinar_completed')!,
            label: '90%視聴完了',
          }]
        : []),
    ]
      .filter((milestone) => position < milestone.seconds)
      .sort((a, b) => a.seconds - b.seconds);

    const ctaReward = webinar.has_cta && !webinar.cta_clicked
      ? (amounts.get('webinar_cta_clicked') ?? 0)
      : 0;
    const rewardMiles = milestones.reduce((sum, milestone) => sum + milestone.amount, 0) + ctaReward;
    if (rewardMiles <= 0) continue;

    const next = milestones[0];
    const secondsToNext = next ? Math.max(0, next.seconds - position) : duration;
    const minutesToNext = Math.max(1, Math.ceil(secondsToNext / 60));
    const description = next
      ? position > 0
        ? `続きからあと約${minutesToNext}分で「${next.label}」+${next.amount} mile`
        : `まず${next.label}で +${next.amount} mile`
      : `配信内の案内を確認すると +${ctaReward} mile`;

    opportunities.push({
      id: `webinar:${webinar.id}`,
      type: 'webinar',
      title: webinar.title,
      description,
      rewardMiles,
      nextRewardMiles: next?.amount ?? ctaReward,
      progressPercent: Math.min(100, Math.max(0, Math.round((position / duration) * 100))),
      ctaLabel: position > 0 ? '続きから参加する' : '今すぐ参加する',
      url: `https://liff.line.me/${webinar.liff_id}/?page=webinar&slug=${encodeURIComponent(webinar.slug)}`,
      secondsToNext,
    });
  }

  return opportunities
    .sort((a, b) => a.secondsToNext - b.secondsToNext || b.rewardMiles - a.rewardMiles)
    .slice(0, limit)
    .map(({ secondsToNext: _secondsToNext, ...opportunity }) => opportunity);
}

export interface MileageRuleRow {
  id: string;
  program_id: string;
  name: string;
  event_type: string;
  source: string | null;
  amount: number;
  initial_status: 'pending' | 'available';
  conditions: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface MileageRuleConditions {
  /** Maximum rewarded actions for the same identity on one calendar day. */
  dailyCapActions?: number;
  /** Reward an identity only once for the supplied subjectKey (for example, a form). */
  uniquePerSubject?: boolean;
  /** Reward the supplied subjectKey once per identity and calendar day. */
  uniquePerSubjectPerDay?: boolean;
  /** Fixed bonuses such as registration/tenure are not multiplied by a tier. */
  ignoreMultiplier?: boolean;
  /** Send the grant to the person who introduced the actor through an ASP link. */
  beneficiary?: 'actor' | 'referrer';
  /** Reward a referrer only once for each referred person. */
  uniquePerReferredFriend?: boolean;
  /** Reward a referrer once per referred person and subject (for example, webinar). */
  uniquePerReferredFriendPerSubject?: boolean;
}

export async function getMileageRules(
  db: D1Database,
  programId = DEFAULT_MILEAGE_PROGRAM_ID,
): Promise<MileageRuleRow[]> {
  await ensureBuiltInProgram(db, programId);
  const result = await db
    .prepare(
      `SELECT * FROM mileage_rules
        WHERE program_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .bind(programId)
    .all<MileageRuleRow>();
  return result.results;
}

export async function getMileageRuleById(
  db: D1Database,
  id: string,
): Promise<MileageRuleRow | null> {
  return db.prepare(`SELECT * FROM mileage_rules WHERE id = ?`).bind(id).first<MileageRuleRow>();
}

export async function createMileageRule(
  db: D1Database,
  input: {
    name: string;
    eventType: string;
    source?: string | null;
    amount: number;
    initialStatus?: 'pending' | 'available';
    conditions?: MileageRuleConditions | null;
  },
): Promise<MileageRuleRow> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Mileage rule amount must be a positive integer');
  }
  await ensureDefaultMileageProgram(db);
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO mileage_rules
         (id, program_id, name, event_type, source, amount, initial_status,
          conditions, is_active, created_at, updated_at)
       VALUES (?, 'default', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.eventType,
      input.source ?? null,
      input.amount,
      input.initialStatus ?? 'available',
      input.conditions ? JSON.stringify(input.conditions) : null,
      now,
      now,
    )
    .run();
  const created = await getMileageRuleById(db, id);
  if (!created) throw new Error('Failed to create mileage rule');
  return created;
}

export async function updateMileageRule(
  db: D1Database,
  id: string,
  updates: Partial<{
    name: string;
    eventType: string;
    source: string | null;
    amount: number;
    initialStatus: 'pending' | 'available';
    conditions: MileageRuleConditions | null;
    isActive: boolean;
  }>,
): Promise<MileageRuleRow | null> {
  if (updates.amount !== undefined && (!Number.isInteger(updates.amount) || updates.amount <= 0)) {
    throw new Error('Mileage rule amount must be a positive integer');
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.eventType !== undefined) { sets.push('event_type = ?'); values.push(updates.eventType); }
  if (updates.source !== undefined) { sets.push('source = ?'); values.push(updates.source); }
  if (updates.amount !== undefined) { sets.push('amount = ?'); values.push(updates.amount); }
  if (updates.initialStatus !== undefined) { sets.push('initial_status = ?'); values.push(updates.initialStatus); }
  if (updates.conditions !== undefined) {
    sets.push('conditions = ?');
    values.push(updates.conditions ? JSON.stringify(updates.conditions) : null);
  }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return getMileageRuleById(db, id);
  sets.push('updated_at = ?');
  values.push(jstNow(), id);
  await db.prepare(`UPDATE mileage_rules SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getMileageRuleById(db, id);
}

export async function deleteMileageRule(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM mileage_rules WHERE id = ?`).bind(id).run();
}

export interface ApplyMileageRulesInput {
  eventType: string;
  source: string;
  sourceEventId: string;
  friendId: string;
  subjectKey?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
}

interface MileageMultiplier {
  bps: number;
  tagId: string | null;
  tagName: string | null;
}

interface ReferralMileageBeneficiary {
  affiliateId: string;
  refCode: string;
  friendId: string;
  userId: string | null;
}

/**
 * Resolve the affiliate who actually introduced this person.
 *
 * Unlike a purchase attribution window, an introduction is permanent. We use
 * an affiliate touch around the first registration (±1 day covers OAuth where
 * the friend row is created immediately before ref_tracking), search linked
 * LINE-account rows, and exclude self-referrals by canonical users.id.
 */
async function resolveReferralMileageBeneficiary(
  db: D1Database,
  referredFriendId: string,
): Promise<ReferralMileageBeneficiary | null> {
  const row = await db
    .prepare(
      `WITH origin AS (
         SELECT user_id FROM friends WHERE id = ?
       ), referred_friends AS (
         SELECT f.id, f.user_id, f.created_at
           FROM friends f
           LEFT JOIN origin o ON 1 = 1
          WHERE f.id = ? OR (o.user_id IS NOT NULL AND f.user_id = o.user_id)
       )
       SELECT a.id AS affiliate_id, al.ref_code,
              a.friend_id AS referrer_friend_id,
              referrer.user_id AS referrer_user_id
         FROM referred_friends referred
         JOIN ref_tracking rt ON rt.friend_id = referred.id
         JOIN affiliate_links al ON al.ref_code = rt.ref_code
         JOIN affiliates a ON a.id = al.affiliate_id
         JOIN friends referrer ON referrer.id = a.friend_id
        WHERE julianday(rt.created_at) >= julianday(referred.created_at) - 1
          AND julianday(rt.created_at) <= julianday(referred.created_at) + 1
          AND a.friend_id != referred.id
          AND (referred.user_id IS NULL OR referrer.user_id IS NULL
               OR referrer.user_id != referred.user_id)
        ORDER BY julianday(rt.created_at) DESC, rt.id DESC
        LIMIT 1`,
    )
    .bind(referredFriendId, referredFriendId)
    .first<{
      affiliate_id: string;
      ref_code: string;
      referrer_friend_id: string;
      referrer_user_id: string | null;
    }>();
  return row
    ? {
        affiliateId: row.affiliate_id,
        refCode: row.ref_code,
        friendId: row.referrer_friend_id,
        userId: row.referrer_user_id,
      }
    : null;
}

async function resolveMileageMultiplier(
  db: D1Database,
  friendId: string,
  occurredAt: string,
): Promise<MileageMultiplier> {
  const row = await db
    .prepare(
      `WITH identity AS (SELECT user_id FROM friends WHERE id = ?)
       SELECT t.mileage_multiplier_bps AS bps, t.id AS tag_id, t.name AS tag_name
         FROM friend_tags ft
         JOIN friends f ON f.id = ft.friend_id
         JOIN tags t ON t.id = ft.tag_id
         LEFT JOIN identity i ON 1 = 1
        WHERE t.mileage_multiplier_bps IS NOT NULL
          AND ft.assigned_at <= ?
          AND (f.id = ? OR (i.user_id IS NOT NULL AND f.user_id = i.user_id))
        ORDER BY t.mileage_multiplier_priority DESC, ft.assigned_at DESC, t.id ASC
        LIMIT 1`,
    )
    .bind(friendId, occurredAt, friendId)
    .first<{ bps: number; tag_id: string; tag_name: string }>();
  return row
    ? { bps: Number(row.bps), tagId: row.tag_id, tagName: row.tag_name }
    : { bps: 10000, tagId: null, tagName: null };
}

/**
 * Normalize one product action and apply every matching mileage rule exactly
 * once. Caps are evaluated against the canonical users.id identity, so a user
 * cannot reset a daily cap merely by switching between LINE accounts.
 */
async function applyMileageRulesImmediately(
  db: D1Database,
  input: ApplyMileageRulesInput,
): Promise<{ event: EngagementEvent; granted: MileageLedgerEntry[] }> {
  const friend = await db
    .prepare(`SELECT id, user_id FROM friends WHERE id = ?`)
    .bind(input.friendId)
    .first<{ id: string; user_id: string | null }>();
  if (!friend) throw new Error(`Mileage friend not found: ${input.friendId}`);

  const occurredAt = input.occurredAt ?? jstNow();
  const metadata = {
    ...(input.metadata ?? {}),
    ...(input.subjectKey ? { subjectKey: input.subjectKey } : {}),
  };
  const event = await recordEngagementEvent(db, {
    idempotencyKey: `${input.source}:${input.eventType}:${input.sourceEventId}`,
    eventType: input.eventType,
    source: input.source,
    sourceEventId: input.sourceEventId,
    actorUserId: friend.user_id,
    actorFriendId: friend.id,
    metadata,
    occurredAt,
  });

  const rulesResult = await db
    .prepare(
      `SELECT * FROM mileage_rules
        WHERE program_id = 'default'
          AND event_type = ?
          AND (source IS NULL OR source = ?)
          AND is_active = 1
          AND (valid_from IS NULL OR valid_from <= ?)
          AND (valid_until IS NULL OR valid_until >= ?)
        ORDER BY created_at ASC, id ASC`,
    )
    .bind(input.eventType, input.source, occurredAt, occurredAt)
    .all<MileageRuleRow>();

  const identityKey = friend.user_id ? `user:${friend.user_id}` : `friend:${friend.id}`;
  const granted: MileageLedgerEntry[] = [];
  const actorMultiplier = await resolveMileageMultiplier(db, friend.id, occurredAt);
  let referralBeneficiaryPromise: Promise<ReferralMileageBeneficiary | null> | null = null;
  const getReferralBeneficiary = () => {
    referralBeneficiaryPromise ??= resolveReferralMileageBeneficiary(db, friend.id);
    return referralBeneficiaryPromise;
  };

  if (input.eventType === 'tag_added' && input.subjectKey) {
    const tag = await db
      .prepare(
        `SELECT id, name, mileage_reward, referral_mileage_reward FROM tags WHERE id = ?`,
      )
      .bind(input.subjectKey)
      .first<{
        id: string;
        name: string;
        mileage_reward: number;
        referral_mileage_reward: number;
      }>();
    if (tag && Number(tag.mileage_reward) > 0) {
      const tagEntry = await postMileageEntry(db, {
        beneficiaryUserId: friend.user_id,
        beneficiaryFriendId: friend.id,
        engagementEventId: event.id,
        entryType: 'grant',
        status: 'available',
        amount: Number(tag.mileage_reward),
        reason: `タグ「${tag.name}」獲得`,
        source: 'tag',
        sourceEventId: input.sourceEventId,
        idempotencyKey: `tag-reward:identity:${identityKey}:tag:${tag.id}`,
        metadata: { tagId: tag.id, eventType: input.eventType },
        occurredAt,
      });
      granted.push(tagEntry);
    }
    if (tag && Number(tag.referral_mileage_reward) > 0) {
      const referrer = await getReferralBeneficiary();
      if (referrer) {
        const referrerIdentityKey = referrer.userId
          ? `user:${referrer.userId}`
          : `friend:${referrer.friendId}`;
        const referralEntry = await postMileageEntry(db, {
          beneficiaryUserId: referrer.userId,
          beneficiaryFriendId: referrer.friendId,
          engagementEventId: event.id,
          entryType: 'grant',
          status: 'available',
          amount: Number(tag.referral_mileage_reward),
          reason: `紹介した友だちがタグ「${tag.name}」を獲得`,
          source: 'tag_referral',
          sourceEventId: input.sourceEventId,
          idempotencyKey: `tag-referral:referrer:${referrerIdentityKey}:referred:${identityKey}:tag:${tag.id}`,
          metadata: {
            tagId: tag.id,
            eventType: input.eventType,
            beneficiaryType: 'referrer',
            affiliateId: referrer.affiliateId,
            refCode: referrer.refCode,
            referredFriendId: friend.id,
            referredUserId: friend.user_id,
          },
          occurredAt,
        });
        granted.push(referralEntry);
      }
    }
  }

  for (const rule of rulesResult.results) {
    let conditions: MileageRuleConditions = {};
    if (rule.conditions) {
      try { conditions = JSON.parse(rule.conditions) as MileageRuleConditions; } catch { conditions = {}; }
    }

    const referrer = conditions.beneficiary === 'referrer'
      ? await getReferralBeneficiary()
      : null;
    if (conditions.beneficiary === 'referrer' && !referrer) continue;
    const beneficiaryFriendId = referrer?.friendId ?? friend.id;
    const beneficiaryUserId = referrer?.userId ?? friend.user_id;
    const beneficiaryIdentityKey = beneficiaryUserId
      ? `user:${beneficiaryUserId}`
      : `friend:${beneficiaryFriendId}`;
    const multiplier = conditions.beneficiary === 'referrer'
      ? await resolveMileageMultiplier(db, beneficiaryFriendId, occurredAt)
      : actorMultiplier;

    if (conditions.dailyCapActions && conditions.dailyCapActions > 0) {
      const capRow = await db
        .prepare(
          `SELECT COUNT(*) AS action_count
             FROM mileage_ledger ml
            WHERE ml.program_id = ?
              AND ml.mileage_rule_id = ?
              AND ml.entry_type = 'grant'
              AND ml.status != 'void'
              AND substr(ml.occurred_at, 1, 10) = substr(?, 1, 10)
              AND ((? IS NOT NULL AND ml.beneficiary_user_id = ?)
                   OR (? IS NULL AND ml.beneficiary_friend_id = ?))`,
        )
        .bind(
          rule.program_id,
          rule.id,
          occurredAt,
          beneficiaryUserId,
          beneficiaryUserId,
          beneficiaryUserId,
          beneficiaryFriendId,
        )
        .first<{ action_count: number }>();
      if ((capRow?.action_count ?? 0) >= conditions.dailyCapActions) continue;
    }

    const idempotencyKey = conditions.uniquePerReferredFriendPerSubject && input.subjectKey
      ? `rule:${rule.id}:referrer:${beneficiaryIdentityKey}:referred:${identityKey}:subject:${input.subjectKey}`
      : conditions.uniquePerReferredFriend
        ? `rule:${rule.id}:referrer:${beneficiaryIdentityKey}:referred:${identityKey}`
        : conditions.uniquePerSubject && input.subjectKey
          ? `rule:${rule.id}:identity:${beneficiaryIdentityKey}:subject:${input.subjectKey}`
          : conditions.uniquePerSubjectPerDay && input.subjectKey
            ? `rule:${rule.id}:identity:${beneficiaryIdentityKey}:day:${occurredAt.slice(0, 10)}:subject:${input.subjectKey}`
            : `rule:${rule.id}:event:${event.id}`;
    const entry = await postMileageEntry(db, {
      programId: rule.program_id,
      beneficiaryUserId,
      beneficiaryFriendId,
      engagementEventId: event.id,
      mileageRuleId: rule.id,
      entryType: 'grant',
      status: rule.initial_status,
      amount: conditions.ignoreMultiplier
        ? rule.amount
        : Math.max(1, Math.round((rule.amount * multiplier.bps) / 10000)),
      reason: rule.name,
      source: input.source,
      sourceEventId: input.sourceEventId,
      idempotencyKey,
      metadata: {
        ...metadata,
        ruleId: rule.id,
        eventType: input.eventType,
        baseAmount: rule.amount,
        multiplierBps: multiplier.bps,
        multiplierTagId: multiplier.tagId,
        multiplierTagName: multiplier.tagName,
        beneficiaryType: conditions.beneficiary ?? 'actor',
        ...(referrer ? {
          affiliateId: referrer.affiliateId,
          refCode: referrer.refCode,
          referredFriendId: friend.id,
          referredUserId: friend.user_id,
        } : {}),
      },
      occurredAt,
    });
    granted.push(entry);
  }
  return { event, granted };
}

/**
 * Public ingestion path. Product requests only write the normalized action and
 * one small queue row; the scheduled worker projects ledger entries later.
 */
export async function applyMileageRulesForEvent(
  db: D1Database,
  input: ApplyMileageRulesInput,
): Promise<{ event: EngagementEvent; granted: MileageLedgerEntry[]; queued: true }> {
  const event = await enqueueMileageEvent(db, input);
  return { event, granted: [], queued: true };
}

export interface MileageQueueResult {
  claimed: number;
  processed: number;
  failed: number;
  granted: number;
}

/** Drain a bounded batch. Safe for retries and overlapping cron invocations. */
export async function processPendingMileageEvents(
  db: D1Database,
  options: { limit?: number; now?: string } = {},
): Promise<MileageQueueResult> {
  const limit = Math.min(250, Math.max(1, options.limit ?? 100));
  const now = options.now ?? jstNow();
  await db
    .prepare(
      `UPDATE mileage_event_queue
          SET status = 'pending', processing_started_at = NULL, updated_at = ?
        WHERE status = 'processing'
          AND datetime(processing_started_at) < datetime(?, '-10 minutes')`,
    )
    .bind(now, now)
    .run();

  const due = await db
    .prepare(
      `SELECT q.engagement_event_id
         FROM mileage_event_queue q
        WHERE q.status IN ('pending','failed')
          AND q.attempts < 5
          AND datetime(q.available_at) <= datetime(?)
        ORDER BY q.created_at ASC, q.engagement_event_id ASC
        LIMIT ?`,
    )
    .bind(now, limit)
    .all<{ engagement_event_id: string }>();

  const result: MileageQueueResult = { claimed: 0, processed: 0, failed: 0, granted: 0 };
  for (const item of due.results) {
    const claim = await db
      .prepare(
        `UPDATE mileage_event_queue
            SET status = 'processing', attempts = attempts + 1,
                processing_started_at = ?, updated_at = ?, last_error = NULL
          WHERE engagement_event_id = ? AND status IN ('pending','failed')`,
      )
      .bind(now, now, item.engagement_event_id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    result.claimed += 1;

    try {
      const event = await db
        .prepare(`SELECT * FROM engagement_events WHERE id = ?`)
        .bind(item.engagement_event_id)
        .first<EngagementEvent>();
      if (!event?.actor_friend_id || !event.source_event_id) {
        throw new Error('Queued mileage event has no friend or source event');
      }
      let metadata: Record<string, unknown> = {};
      if (event.metadata) {
        try { metadata = JSON.parse(event.metadata) as Record<string, unknown>; } catch { metadata = {}; }
      }
      const projection = await applyMileageRulesImmediately(db, {
        eventType: event.event_type,
        source: event.source,
        sourceEventId: event.source_event_id,
        friendId: event.actor_friend_id,
        subjectKey: typeof metadata.subjectKey === 'string' ? metadata.subjectKey : null,
        metadata,
        occurredAt: event.occurred_at,
      });
      result.granted += projection.granted.length;
      result.processed += 1;
      await db
        .prepare(
          `UPDATE mileage_event_queue
              SET status = 'processed', processed_at = ?, processing_started_at = NULL,
                  updated_at = ?, last_error = NULL
            WHERE engagement_event_id = ?`,
        )
        .bind(now, now, event.id)
        .run();
    } catch (error) {
      result.failed += 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      await db
        .prepare(
          `UPDATE mileage_event_queue
              SET status = 'failed', processing_started_at = NULL,
                  available_at = datetime(?, '+' || MIN(attempts * 5, 60) || ' minutes'),
                  updated_at = ?, last_error = ?
            WHERE engagement_event_id = ?`,
        )
        .bind(now, now, message, item.engagement_event_id)
        .run();
    }
  }
  return result;
}

const FOLLOWING_MILESTONES = [
  { eventType: 'friend_registered', days: 0, name: '友だち登録' },
  { eventType: 'friend_following_7d', days: 7, name: '継続フォロー7日' },
  { eventType: 'friend_following_30d', days: 30, name: '継続フォロー30日' },
  { eventType: 'friend_following_90d', days: 90, name: '継続フォロー90日' },
  { eventType: 'friend_following_180d', days: 180, name: '継続フォロー180日' },
  { eventType: 'friend_following_365d', days: 365, name: '継続フォロー1年' },
] as const;

export interface FollowingMileageReconcileResult {
  eventsCreated: number;
  queued: number;
}

/**
 * Materialize registration/continuous-follow milestones in bounded chunks.
 * Called on the existing 6-hour cron. Historic accounts are gradually caught
 * up without a full-table write spike; normal queue processing remains 5-minutely.
 */
export async function enqueueFollowingMileageMilestones(
  db: D1Database,
  options: { limitPerMilestone?: number; now?: string } = {},
): Promise<FollowingMileageReconcileResult> {
  const limit = Math.min(2000, Math.max(1, options.limitPerMilestone ?? 1000));
  const now = options.now ?? jstNow();
  const totals: FollowingMileageReconcileResult = { eventsCreated: 0, queued: 0 };

  for (const milestone of FOLLOWING_MILESTONES) {
    const anchorSql = milestone.days === 0 ? 'f.first_followed_at' : 'f.current_follow_started_at';
    const earnedAtSql = milestone.days === 0
      ? 'f.first_followed_at'
      : `datetime(f.current_follow_started_at, '+${milestone.days} days')`;
    const eventIdSql = `'loyalty:${milestone.eventType}:' || f.id || ':' || ${anchorSql}`;
    const sourceIdSql = `f.id || ':${milestone.eventType}:' || ${anchorSql}`;
    const eligibilitySql = milestone.days === 0
      ? 'f.first_followed_at IS NOT NULL'
      : `f.current_follow_started_at IS NOT NULL
         AND julianday(?) - julianday(f.current_follow_started_at) >= ${milestone.days}`;
    const insertBinds = milestone.days === 0 ? [now, limit] : [now, now, limit];

    const inserted = await db
      .prepare(
        `INSERT OR IGNORE INTO engagement_events
           (id, program_id, idempotency_key, event_type, source, source_event_id,
            actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
         SELECT ${eventIdSql}, 'default',
                'line_relationship:${milestone.eventType}:' || ${sourceIdSql},
                '${milestone.eventType}', 'line_relationship', ${sourceIdSql},
                f.user_id, f.id,
                json_object('milestoneDays', ${milestone.days}, 'followStartedAt', ${anchorSql},
                            'subjectKey', ${sourceIdSql}),
                ${earnedAtSql}, ?
           FROM friends f
          WHERE f.is_following = 1
            AND ${eligibilitySql}
            AND NOT EXISTS (
              SELECT 1 FROM engagement_events ee WHERE ee.id = ${eventIdSql}
            )
          ORDER BY ${anchorSql} ASC, f.id ASC
          LIMIT ?`,
      )
      .bind(...insertBinds)
      .run();
    totals.eventsCreated += inserted.meta?.changes ?? 0;

    const queued = await db
      .prepare(
        `INSERT OR IGNORE INTO mileage_event_queue
           (engagement_event_id, status, attempts, available_at, created_at, updated_at)
         SELECT ee.id, 'pending', 0, ?, ?, ?
           FROM engagement_events ee
          WHERE ee.event_type = ?
            AND ee.source = 'line_relationship'
            AND NOT EXISTS (
              SELECT 1 FROM mileage_event_queue q WHERE q.engagement_event_id = ee.id
            )
          ORDER BY ee.occurred_at ASC, ee.id ASC
          LIMIT ?`,
      )
      .bind(now, now, now, milestone.eventType, limit)
      .run();
    totals.queued += queued.meta?.changes ?? 0;
  }
  return totals;
}

export interface MileageAdminMember {
  identityKey: string;
  primaryFriendId: string;
  displayName: string;
  pictureUrl: string | null;
  accountCount: number;
  accountNames: string[];
  available: number;
  pending: number;
  lifetimeEarned: number;
  actionCount: number;
  messageCount: number;
  linkClickCount: number;
  formCount: number;
  bookingCount: number;
  webinarCount: number;
  instagramCount: number;
  followingDays: number;
  unfollowCount: number;
  referralMiles: number;
  qualityReferralCount: number;
  lastActivityAt: string | null;
}

export interface MileageAdminOverview {
  summary: {
    totalMembers: number;
    totalAvailable: number;
    activeMembers30d: number;
    totalActions: number;
    queuedEvents: number;
  };
  members: MileageAdminMember[];
  pagination: { total: number; limit: number; offset: number };
}

/** Aggregate one wallet per canonical user across all connected LINE accounts. */
export async function getMileageAdminOverview(
  db: D1Database,
  options: { accountId?: string | null; search?: string; limit?: number; offset?: number } = {},
): Promise<MileageAdminOverview> {
  await ensureDefaultMileageProgram(db);
  const accountId = options.accountId || null;
  const search = (options.search ?? '').trim();
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  const ctes = `WITH profiles AS (
    SELECT CASE WHEN f.user_id IS NOT NULL THEN 'user:' || f.user_id ELSE 'friend:' || f.id END AS identity_key,
           MIN(f.id) AS primary_friend_id,
           COALESCE(MAX(u.display_name), MAX(f.display_name), '名前未設定') AS display_name,
           MAX(f.picture_url) AS picture_url,
           COUNT(DISTINCT f.line_account_id) AS account_count,
           GROUP_CONCAT(DISTINCT COALESCE(la.name, '未設定')) AS account_names,
           MAX(CASE
                 WHEN f.is_following = 1
                  AND f.current_follow_started_at IS NOT NULL
                  AND julianday('now', '+9 hours') > julianday(f.current_follow_started_at)
                 THEN CAST(julianday('now', '+9 hours') - julianday(f.current_follow_started_at) AS INTEGER)
                 ELSE 0
               END) AS following_days,
           SUM(COALESCE(f.unfollow_count, 0)) AS unfollow_count
      FROM friends f
      LEFT JOIN users u ON u.id = f.user_id
      LEFT JOIN line_accounts la ON la.id = f.line_account_id
     WHERE (? IS NULL OR f.line_account_id = ?)
     GROUP BY identity_key
  ), wallet AS (
    SELECT CASE
             WHEN COALESCE(ml.beneficiary_user_id, bf.user_id) IS NOT NULL
               THEN 'user:' || COALESCE(ml.beneficiary_user_id, bf.user_id)
             ELSE 'friend:' || ml.beneficiary_friend_id
           END AS identity_key,
           COALESCE(SUM(CASE WHEN ml.status = 'available' THEN ml.amount ELSE 0 END), 0) AS available,
           COALESCE(SUM(CASE WHEN ml.status = 'pending' THEN ml.amount ELSE 0 END), 0) AS pending,
           COALESCE(SUM(CASE WHEN ml.entry_type = 'grant' AND ml.amount > 0 THEN ml.amount ELSE 0 END), 0) AS lifetime_earned,
           COALESCE(SUM(CASE
             WHEN ml.status = 'available'
              AND (ml.source = 'tag_referral'
                   OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
             THEN ml.amount ELSE 0 END), 0) AS referral_miles,
           COUNT(DISTINCT CASE
             WHEN ml.entry_type = 'grant'
              AND (ml.source = 'tag_referral'
                   OR json_extract(ml.metadata, '$.beneficiaryType') = 'referrer')
             THEN COALESCE(json_extract(ml.metadata, '$.referredUserId'),
                           json_extract(ml.metadata, '$.referredFriendId'))
             ELSE NULL END) AS quality_referral_count
      FROM mileage_ledger ml
      LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
     WHERE ml.program_id = 'default'
       AND (? IS NULL OR bf.line_account_id = ?)
     GROUP BY identity_key
  ), activity AS (
    SELECT CASE
             WHEN COALESCE(ee.actor_user_id, af.user_id) IS NOT NULL
               THEN 'user:' || COALESCE(ee.actor_user_id, af.user_id)
             ELSE 'friend:' || ee.actor_friend_id
           END AS identity_key,
           COUNT(*) AS action_count,
           SUM(CASE WHEN ee.event_type = 'message_received' THEN 1 ELSE 0 END) AS message_count,
           SUM(CASE WHEN ee.event_type = 'link_clicked' THEN 1 ELSE 0 END) AS link_click_count,
           SUM(CASE WHEN ee.event_type = 'form_submitted' THEN 1 ELSE 0 END) AS form_count,
           SUM(CASE WHEN ee.event_type = 'booking_created' THEN 1 ELSE 0 END) AS booking_count,
           SUM(CASE WHEN ee.source = 'webinar' THEN 1 ELSE 0 END) AS webinar_count,
           SUM(CASE WHEN ee.source = 'instagram' THEN 1 ELSE 0 END) AS instagram_count,
           MAX(ee.occurred_at) AS last_activity_at
      FROM engagement_events ee
      LEFT JOIN friends af ON af.id = ee.actor_friend_id
     WHERE ee.program_id = 'default'
       AND ee.actor_friend_id IS NOT NULL
       AND (? IS NULL OR af.line_account_id = ?)
     GROUP BY identity_key
  )`;
  const scopeBinds = [accountId, accountId, accountId, accountId, accountId, accountId];

  const rows = await db
    .prepare(
      `${ctes}
       SELECT p.*, COALESCE(w.available, 0) AS available,
              COALESCE(w.pending, 0) AS pending,
              COALESCE(w.lifetime_earned, 0) AS lifetime_earned,
              COALESCE(w.referral_miles, 0) AS referral_miles,
              COALESCE(w.quality_referral_count, 0) AS quality_referral_count,
              COALESCE(a.action_count, 0) AS action_count,
              COALESCE(a.message_count, 0) AS message_count,
              COALESCE(a.link_click_count, 0) AS link_click_count,
              COALESCE(a.form_count, 0) AS form_count,
              COALESCE(a.booking_count, 0) AS booking_count,
              COALESCE(a.webinar_count, 0) AS webinar_count,
              COALESCE(a.instagram_count, 0) AS instagram_count,
              a.last_activity_at,
              COUNT(*) OVER() AS filtered_count
         FROM profiles p
         LEFT JOIN wallet w ON w.identity_key = p.identity_key
         LEFT JOIN activity a ON a.identity_key = p.identity_key
        WHERE (? = '' OR p.display_name LIKE '%' || ? || '%')
        ORDER BY available DESC, action_count DESC, p.display_name ASC
        LIMIT ? OFFSET ?`,
    )
    .bind(...scopeBinds, search, search, limit, offset)
    .all<{
      identity_key: string;
      primary_friend_id: string;
      display_name: string;
      picture_url: string | null;
      account_count: number;
      account_names: string | null;
      available: number;
      pending: number;
      lifetime_earned: number;
      referral_miles: number;
      quality_referral_count: number;
      action_count: number;
      message_count: number;
      link_click_count: number;
      form_count: number;
      booking_count: number;
      webinar_count: number;
      instagram_count: number;
      following_days: number;
      unfollow_count: number;
      last_activity_at: string | null;
      filtered_count: number;
    }>();

  const summary = await db
    .prepare(
      `${ctes}
       SELECT COUNT(*) AS total_members,
              COALESCE(SUM(COALESCE(w.available, 0)), 0) AS total_available,
              SUM(CASE WHEN datetime(a.last_activity_at) >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS active_members_30d,
              COALESCE(SUM(COALESCE(a.action_count, 0)), 0) AS total_actions
         FROM profiles p
         LEFT JOIN wallet w ON w.identity_key = p.identity_key
         LEFT JOIN activity a ON a.identity_key = p.identity_key`,
    )
    .bind(...scopeBinds)
    .first<{
      total_members: number;
      total_available: number;
      active_members_30d: number;
      total_actions: number;
    }>();
  const queueSummary = await db
    .prepare(
      `SELECT COUNT(*) AS queued_events
         FROM mileage_event_queue
        WHERE status IN ('pending','processing','failed') AND attempts < 5`,
    )
    .bind()
    .first<{ queued_events: number }>();

  return {
    summary: {
      totalMembers: Number(summary?.total_members ?? 0),
      totalAvailable: Number(summary?.total_available ?? 0),
      activeMembers30d: Number(summary?.active_members_30d ?? 0),
      totalActions: Number(summary?.total_actions ?? 0),
      queuedEvents: Number(queueSummary?.queued_events ?? 0),
    },
    members: rows.results.map((row) => ({
      identityKey: row.identity_key,
      primaryFriendId: row.primary_friend_id,
      displayName: row.display_name,
      pictureUrl: row.picture_url,
      accountCount: Number(row.account_count),
      accountNames: row.account_names ? row.account_names.split(',') : [],
      available: Number(row.available),
      pending: Number(row.pending),
      lifetimeEarned: Number(row.lifetime_earned),
      referralMiles: Number(row.referral_miles),
      qualityReferralCount: Number(row.quality_referral_count),
      actionCount: Number(row.action_count),
      messageCount: Number(row.message_count),
      linkClickCount: Number(row.link_click_count),
      formCount: Number(row.form_count),
      bookingCount: Number(row.booking_count),
      webinarCount: Number(row.webinar_count),
      instagramCount: Number(row.instagram_count),
      followingDays: Number(row.following_days),
      unfollowCount: Number(row.unfollow_count),
      lastActivityAt: row.last_activity_at,
    })),
    pagination: {
      total: Number(rows.results[0]?.filtered_count ?? 0),
      limit,
      offset,
    },
  };
}

interface AffiliateConversionMileageContext {
  event_id: string;
  approval_status: 'approved' | 'rejected';
  approved_at: string | null;
  created_at: string;
  subject_friend_id: string;
  subject_user_id: string | null;
  beneficiary_friend_id: string | null;
  beneficiary_user_id: string | null;
  offer_id: string | null;
  offer_name: string | null;
  reward_miles: number | null;
  mileage_program_id: string | null;
}

/**
 * Project one ASP approval decision into the generic mileage foundation.
 * Repeated calls are safe. Rejection appends compensating entries instead of
 * deleting or editing the original grants, preserving a complete audit trail.
 */
export async function syncAffiliateConversionMileage(
  db: D1Database,
  eventId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  const context = await db
    .prepare(
      `SELECT ce.id AS event_id,
              ce.approval_status,
              ce.approved_at,
              ce.created_at,
              ce.friend_id AS subject_friend_id,
              subject.user_id AS subject_user_id,
              a.friend_id AS beneficiary_friend_id,
              beneficiary.user_id AS beneficiary_user_id,
              off.id AS offer_id,
              off.name AS offer_name,
              off.reward_miles,
              off.mileage_program_id
         FROM conversion_events ce
         JOIN affiliates a ON a.id = ce.affiliate_id
         LEFT JOIN friends subject ON subject.id = ce.friend_id
         LEFT JOIN friends beneficiary ON beneficiary.id = a.friend_id
         LEFT JOIN affiliate_links al
           ON al.ref_code = ce.attributed_ref_code
          AND al.affiliate_id = ce.affiliate_id
         LEFT JOIN affiliate_offers off ON off.id = al.offer_id
        WHERE ce.id = ? AND ce.affiliate_id IS NOT NULL`,
    )
    .bind(eventId)
    .first<AffiliateConversionMileageContext>();

  if (!context) throw new Error(`Attributed conversion event not found: ${eventId}`);
  if (context.approval_status !== status) {
    throw new Error(`Conversion approval status changed while syncing mileage: ${eventId}`);
  }

  const programId = context.mileage_program_id ?? DEFAULT_MILEAGE_PROGRAM_ID;
  const decisionVersion = context.approved_at ?? `legacy-${status}`;
  const occurredAt = context.approved_at ?? context.created_at;
  const event = await recordEngagementEvent(db, {
    programId,
    idempotencyKey: `affiliate-conversion:${eventId}:${status}:${decisionVersion}`,
    eventType: status === 'approved' ? 'affiliate_conversion_approved' : 'affiliate_conversion_rejected',
    source: 'affiliate_conversion',
    sourceEventId: eventId,
    actorUserId: context.beneficiary_user_id,
    actorFriendId: context.beneficiary_friend_id,
    subjectUserId: context.subject_user_id,
    subjectFriendId: context.subject_friend_id,
    metadata: { offerId: context.offer_id, offerName: context.offer_name },
    occurredAt,
  });

  if (status === 'approved') {
    const rewardMiles = context.reward_miles ?? 0;
    if (rewardMiles <= 0) return;
    await postMileageEntry(db, {
      programId,
      beneficiaryUserId: context.beneficiary_user_id,
      beneficiaryFriendId: context.beneficiary_friend_id,
      engagementEventId: event.id,
      entryType: 'grant',
      status: 'available',
      amount: rewardMiles,
      reason: context.offer_name
        ? `${context.offer_name}の紹介成果承認`
        : '紹介成果承認',
      source: 'affiliate_conversion',
      sourceEventId: eventId,
      idempotencyKey: `affiliate-conversion-grant:${eventId}:${decisionVersion}`,
      metadata: { offerId: context.offer_id, offerName: context.offer_name },
      occurredAt,
    });
    return;
  }

  const grants = await db
    .prepare(
      `SELECT original.*
         FROM mileage_ledger original
         LEFT JOIN mileage_ledger reversal ON reversal.reverses_entry_id = original.id
        WHERE original.program_id = ?
          AND original.source = 'affiliate_conversion'
          AND original.source_event_id = ?
          AND original.entry_type = 'grant'
          AND original.status = 'available'
          AND reversal.id IS NULL`,
    )
    .bind(programId, eventId)
    .all<MileageLedgerEntry>();

  for (const grant of grants.results) {
    await postMileageEntry(db, {
      programId,
      beneficiaryUserId: grant.beneficiary_user_id,
      beneficiaryFriendId: grant.beneficiary_friend_id,
      engagementEventId: event.id,
      entryType: 'reversal',
      status: 'available',
      amount: -grant.amount,
      reason: '紹介成果の却下による取消',
      source: 'affiliate_conversion',
      sourceEventId: eventId,
      idempotencyKey: `affiliate-conversion-reversal:${grant.id}`,
      reversesEntryId: grant.id,
      metadata: { originalEntryId: grant.id },
      occurredAt,
    });
  }
}
