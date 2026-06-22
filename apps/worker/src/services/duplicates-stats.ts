import { IDENTITY_KEY_SQL } from '../lib/identity-key.js';

const MSG_UNIT_YEN = 3;

export interface PerAccountStat {
  account_id: string;
  account_name: string;
  friends: number;
  dups: number;
  dup_rate: number;
}

export interface PairwiseOverlap {
  from_account_id: string;
  to_account_id: string;
  overlap: number;
}

export interface DuplicatesStats {
  total_following: number;
  unique_people: number;
  friend_dups: number;
  duplicate_groups: number;
  wasted_per_broadcast_yen: number;
  msg_unit_yen: number;
  per_account: PerAccountStat[];
  pairwise_overlap: PairwiseOverlap[];
  /** ISO timestamp when this snapshot was computed against D1. */
  computed_at: string;
}

/**
 * Module-level cache. The dashboard's three queries scan friends + JOIN
 * line_accounts, so back-to-back loads add up. Cache the latest snapshot
 * inside the Worker isolate for {@link CACHE_TTL_MS} so refreshes within
 * the TTL window return instantly.
 *
 * NOTE: keyed at module scope (not by db reference). Cloudflare Workers
 * gives each request a freshly constructed `env` object, so a WeakMap
 * keyed by `env.DB` never hit in production — every request looked
 * cold. The Worker isolate hosts a single D1 binding, so a singleton
 * is correct here. Test ordering can be re-isolated with the exported
 * `_resetCacheForTest` helper.
 *
 * Safety lessons from duplicate-detect.ts: never cache an empty/zero
 * result (would mask a misconfigured environment for the isolate's
 * entire lifetime), and always honor the TTL — no permanent caching.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { stats: DuplicatesStats; at: number } | null = null;

/** Test-only: clear the in-isolate cache so unit tests don't leak across each other. */
export function _resetCacheForTest(): void {
  cached = null;
}

const TOTALS_SQL = `
  WITH ident AS (
    SELECT friends.id, friends.line_account_id, (${IDENTITY_KEY_SQL}) AS ident_key
    FROM friends
    JOIN line_accounts ON line_accounts.id = friends.line_account_id
    WHERE friends.is_following = 1 AND line_accounts.is_active = 1
  ),
  groups AS (
    SELECT ident_key, COUNT(DISTINCT line_account_id) AS span, COUNT(*) AS row_cnt
    FROM ident GROUP BY ident_key HAVING COUNT(DISTINCT line_account_id) > 1
  )
  SELECT
    (SELECT COUNT(*) FROM friends
       JOIN line_accounts ON line_accounts.id = friends.line_account_id
       WHERE friends.is_following = 1 AND line_accounts.is_active = 1) AS total_following,
    (SELECT COUNT(*) FROM groups)                                       AS duplicate_groups,
    (SELECT COALESCE(SUM(row_cnt - 1), 0) FROM groups)                  AS friend_dups
`;

const PER_ACCOUNT_SQL = `
  WITH ident AS (
    SELECT friends.id, friends.line_account_id, (${IDENTITY_KEY_SQL}) AS ident_key
    FROM friends
    JOIN line_accounts ON line_accounts.id = friends.line_account_id
    WHERE friends.is_following = 1 AND line_accounts.is_active = 1
  ),
  spans AS (
    SELECT ident_key, COUNT(DISTINCT line_account_id) AS span
    FROM ident GROUP BY ident_key
  )
  SELECT
    la.id   AS account_id,
    la.name AS account_name,
    COUNT(i.id)                                                           AS friends,
    COALESCE(SUM(CASE WHEN s.span > 1 THEN 1 ELSE 0 END), 0)             AS dups
  FROM line_accounts la
  LEFT JOIN ident i ON i.line_account_id = la.id
  LEFT JOIN spans s ON s.ident_key = i.ident_key
  WHERE la.is_active = 1
  GROUP BY la.id, la.name
  ORDER BY (1.0 * COALESCE(SUM(CASE WHEN s.span > 1 THEN 1 ELSE 0 END), 0) /
            NULLIF(COUNT(i.id), 0)) DESC,
           la.name ASC
`;

// For pairwise overlap, the obvious "self-join ident on ident_key" pattern
// trips D1's CPU limit because the CTE has no index — even with a dup-keys
// pre-filter the brute-force join scanned tens of millions of rows.
// Instead, fetch the (line_account_id, ident_key) pairs for keys that
// belong to a duplicate group and compute the directional matrix in JS.
// O(rows + groups·max_accounts²) is cheap for our dataset (~3k rows, ~1.7k
// groups, max 4 accounts).
const PAIRWISE_RAW_SQL = `
  WITH ident AS (
    SELECT friends.id, friends.line_account_id, (${IDENTITY_KEY_SQL}) AS ident_key
    FROM friends
    JOIN line_accounts ON line_accounts.id = friends.line_account_id
    WHERE friends.is_following = 1 AND line_accounts.is_active = 1
  ),
  dup_keys AS (
    SELECT ident_key
    FROM ident
    GROUP BY ident_key
    HAVING COUNT(DISTINCT line_account_id) > 1
  )
  SELECT i.ident_key, i.line_account_id
  FROM ident i
  JOIN dup_keys dk ON dk.ident_key = i.ident_key
`;

export async function computeDuplicatesStats(
  db: D1Database,
  options: { forceRefresh?: boolean } = {},
): Promise<DuplicatesStats> {
  if (!options.forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.stats;
  }

  const totals = await db
    .prepare(TOTALS_SQL)
    .first<{ total_following: number; duplicate_groups: number; friend_dups: number }>();

  const total_following = totals?.total_following ?? 0;
  const duplicate_groups = totals?.duplicate_groups ?? 0;
  const friend_dups = totals?.friend_dups ?? 0;
  const unique_people = total_following - friend_dups;

  const perAccountResult = await db
    .prepare(PER_ACCOUNT_SQL)
    .all<{ account_id: string; account_name: string; friends: number; dups: number }>();

  const per_account: PerAccountStat[] = (perAccountResult.results ?? []).map((row) => ({
    account_id: row.account_id,
    account_name: row.account_name,
    friends: row.friends,
    dups: row.dups,
    dup_rate: row.friends > 0 ? row.dups / row.friends : 0,
  }));

  // Fetch raw (ident_key, line_account_id) pairs for dup groups; compute the
  // pairwise overlap matrix in JS (D1's CPU limit can't handle a self-join
  // on the un-indexed CTE for our dataset size).
  const pairwiseRawResult = await db
    .prepare(PAIRWISE_RAW_SQL)
    .all<{ ident_key: string; line_account_id: string }>();

  const groups = new Map<string, Set<string>>();
  for (const row of pairwiseRawResult.results ?? []) {
    let accounts = groups.get(row.ident_key);
    if (!accounts) {
      accounts = new Set();
      groups.set(row.ident_key, accounts);
    }
    accounts.add(row.line_account_id);
  }

  const overlapMap = new Map<string, Map<string, number>>();
  for (const accounts of groups.values()) {
    const list = [...accounts];
    for (const a of list) {
      let row = overlapMap.get(a);
      if (!row) {
        row = new Map();
        overlapMap.set(a, row);
      }
      for (const b of list) {
        if (a === b) continue;
        row.set(b, (row.get(b) ?? 0) + 1);
      }
    }
  }

  const pairwise_overlap: PairwiseOverlap[] = [];
  for (const [from, byTo] of overlapMap) {
    for (const [to, overlap] of byTo) {
      pairwise_overlap.push({ from_account_id: from, to_account_id: to, overlap });
    }
  }

  const stats: DuplicatesStats = {
    total_following,
    unique_people,
    friend_dups,
    duplicate_groups,
    wasted_per_broadcast_yen: friend_dups * MSG_UNIT_YEN,
    msg_unit_yen: MSG_UNIT_YEN,
    per_account,
    pairwise_overlap,
    computed_at: new Date().toISOString(),
  };

  // Don't cache an empty/zero snapshot — it would mask a real outage
  // (e.g. friends or line_accounts unexpectedly empty) for the rest of
  // this isolate's lifetime.
  // If a zero result comes back AND an older non-zero snapshot is still
  // cached, drop it: the operator just intentionally bypassed the cache,
  // so reverting to the stale non-zero value on the next normal request
  // would be lying to them.
  if (total_following > 0) {
    cached = { stats, at: Date.now() };
  } else {
    cached = null;
  }

  return stats;
}
