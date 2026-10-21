import { URL_TOKEN_SQL } from '../lib/url-token.js';

export interface DedupPreviewPerAccount {
  accountId: string;
  accountName: string;
  accountCountry: string | null;
  selectedCount: number;
  sendCount: number;
  excludedToHigherPriority: number;
  // identKey: dedup の正規化 ID (URL_TOKEN_SQL / 'uid:'||user_id / 'solo:'||friend_id)。
  // resume 時の send 済判定に使う。lineUserId はプロバイダ単位のID なので、
  // 同じ論理人物が別 LINE 公式アカウント (別プロバイダ) にいる場合に二重配信
  // する事故を防ぐため、cross-account でユニークな identKey を採用する。
  recipients: Array<{
    friendId: string;
    lineUserId: string;
    identKey: string;
    displayName: string | null;
  }>;
}

export interface DedupPreviewResult {
  totalSelected: number;
  uniqueRecipients: number;
  reduction: number;
  reductionRate: number;
  perAccount: DedupPreviewPerAccount[];
}

interface RankedRow {
  friend_id: string;
  line_user_id: string;
  line_account_id: string;
  ident_key: string;
  display_name: string | null;
}

/**
 * Compute the per-account dedup preview for a multi-account broadcast.
 * Same function called from preview API and send executor — guarantees that
 * displayed numbers and actually-sent numbers are computed identically (modulo
 * live data drift between preview and send time, which is intentional design).
 *
 * Single SQL with WITH/ROW_NUMBER OVER does the dedup in the DB layer; JS
 * only aggregates per-account. This relies on production D1 supporting
 * ROW_NUMBER() OVER PARTITION BY (SQLite 3.25+; D1 is 3.45+).
 *
 * Filters: is_following=1 AND line_account_id IS NOT NULL.
 * identity_key: COALESCE(URL_TOKEN_SQL, 'uid:'||user_id, 'solo:'||id).
 * Tie-breaking: priority CASE first, created_at ASC second.
 */
export async function computeDedupBroadcastPreview(
  db: D1Database,
  accountIds: string[],
  dedupPriority: string[],
  targetTagId?: string | null,
): Promise<DedupPreviewResult> {
  if (accountIds.length === 0) {
    return { totalSelected: 0, uniqueRecipients: 0, reduction: 0, reductionRate: 0, perAccount: [] };
  }

  const priority = dedupPriority.filter((id) => accountIds.includes(id));

  const inPlaceholders = accountIds.map(() => '?').join(', ');

  const caseWhens = priority.map((_, i) => `WHEN ? THEN ${i}`).join(' ');
  const caseExpr = priority.length === 0
    ? '999'
    : `CASE line_account_id ${caseWhens} ELSE 999 END`;

  // Tag filter — applied identically to both selectedCount and ranked queries
  // so the "selected" denominator and the dedup numerator share the same
  // population. Empty/null targetTagId means "no tag filter".
  const hasTagFilter = !!targetTagId;
  const tagJoinForSelectedCount = hasTagFilter
    ? `AND EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = friends.id AND ft.tag_id = ?)`
    : '';
  const tagJoinForRanked = hasTagFilter
    ? `AND EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`
    : '';

  // Per-account selectedCount.
  const selectedCountSql = `
    SELECT line_account_id, COUNT(*) AS cnt
    FROM friends
    WHERE is_following = 1
      AND line_account_id IN (${inPlaceholders})
      AND line_account_id IS NOT NULL
      ${tagJoinForSelectedCount}
    GROUP BY line_account_id
  `;
  const selectedCountBinds = hasTagFilter
    ? [...accountIds, targetTagId]
    : [...accountIds];
  const selectedCounts = await db
    .prepare(selectedCountSql)
    .bind(...selectedCountBinds)
    .all<{ line_account_id: string; cnt: number }>();

  const selectedCountByAccount = new Map<string, number>();
  for (const row of selectedCounts.results ?? []) {
    selectedCountByAccount.set(row.line_account_id, row.cnt);
  }
  const totalSelected = (selectedCounts.results ?? []).reduce((sum, r) => sum + r.cnt, 0);

  // Ranked query: returns only the rn=1 rows (primary recipients).
  const rankedSql = `
    WITH selected AS (
      SELECT
        f.id            AS friend_id,
        f.line_user_id,
        f.display_name,
        f.line_account_id,
        f.created_at,
        COALESCE(${URL_TOKEN_SQL}, 'uid:'||f.user_id, 'solo:'||f.id) AS ident_key
      FROM friends f
      WHERE f.is_following = 1
        AND f.line_account_id IN (${inPlaceholders})
        AND f.line_account_id IS NOT NULL
        ${tagJoinForRanked}
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY ident_key
          ORDER BY ${caseExpr}, created_at ASC
        ) AS rn
      FROM selected
    )
    SELECT friend_id, line_user_id, line_account_id, ident_key, display_name
    FROM ranked
    WHERE rn = 1
    ORDER BY line_account_id, created_at
  `;
  // Bind order matches placeholder order in the SQL: accountIds (for IN), then
  // tag filter (if any) inside the `selected` CTE, then priority (for the CASE
  // in ORDER BY of the `ranked` CTE).
  const rankedBinds = hasTagFilter
    ? [...accountIds, targetTagId, ...priority]
    : [...accountIds, ...priority];
  const rankedRows = await db
    .prepare(rankedSql)
    .bind(...rankedBinds)
    .all<RankedRow>();

  // Aggregate per-account.
  const sendCountByAccount = new Map<string, RankedRow[]>();
  for (const row of rankedRows.results ?? []) {
    const list = sendCountByAccount.get(row.line_account_id) ?? [];
    list.push(row);
    sendCountByAccount.set(row.line_account_id, list);
  }

  const uniqueRecipients = (rankedRows.results ?? []).length;
  const reduction = totalSelected - uniqueRecipients;
  const reductionRate = totalSelected > 0 ? reduction / totalSelected : 0;

  // Per-account meta.
  const accountMetaSql = `SELECT id, name, country FROM line_accounts WHERE id IN (${inPlaceholders})`;
  const metaRows = await db
    .prepare(accountMetaSql)
    .bind(...accountIds)
    .all<{ id: string; name: string; country: string | null }>();
  const metaByAccount = new Map<string, { name: string; country: string | null }>();
  for (const r of metaRows.results ?? []) {
    metaByAccount.set(r.id, { name: r.name, country: r.country });
  }

  const perAccount: DedupPreviewPerAccount[] = accountIds.map((id) => {
    const selectedCount = selectedCountByAccount.get(id) ?? 0;
    const winners = sendCountByAccount.get(id) ?? [];
    const sendCount = winners.length;
    const meta = metaByAccount.get(id) ?? { name: id, country: null };
    return {
      accountId: id,
      accountName: meta.name,
      accountCountry: meta.country,
      selectedCount,
      sendCount,
      excludedToHigherPriority: selectedCount - sendCount,
      recipients: winners.map((w) => ({
        friendId: w.friend_id,
        lineUserId: w.line_user_id,
        identKey: w.ident_key,
        displayName: w.display_name ?? null,
      })),
    };
  });

  return { totalSelected, uniqueRecipients, reduction, reductionRate, perAccount };
}

import { LineClient } from '@line-crm/line-sdk';
import { getLineAccountById } from '@line-crm/db';
import type { QuotaEnv } from './quota.js';
import { processJournaledDedupBroadcast } from './dedup-delivery-intent.js';

export interface ProcessMultiAccountDedupResult {
  /** The queue caller consumes this exact durable receipt state. */
  journaledProgress?: string | null;
  journaledUnit?: string;
  totalCount: number;
  successCount: number;
  failedAccountIds: string[];
  // クォータ不足でスキップしたアカウントの要約 (last_error 用)。無ければ null。
  // caller が完了状態・集計と同じtransactionで last_error へ保存する。
  quotaSkippedSummary: string | null;
  // false = 時間/使用量上限・受付不明・要確認のため途中で中断した。
  // caller は status='sent' にせず batch_offset=0 に戻して次の cron tick に継続させる。
  // true = 全 account を送り切った (= 完了)。caller が status='sent' にする。
  complete: boolean;
}

/**
 * Projected recipient total of a multi-account-dedup broadcast: the preview's
 * winners summed over active accounts only — the same figure the /send route
 * computes before claiming, and the same population the executor will
 * actually message (it skips inactive/missing accounts). Used by the
 * projected-audience quota guards; dedup has no cheap COUNT, so callers
 * should invoke this only when a monthly limit is active.
 */
export async function projectedDedupAudience(
  db: D1Database,
  broadcast: {
    account_ids: string | null;
    dedup_priority: string | null;
    target_tag_id?: string | null;
  },
): Promise<number> {
  const accountIds = (broadcast.account_ids ? JSON.parse(broadcast.account_ids) : []) as string[];
  const dedupPriority = (broadcast.dedup_priority ? JSON.parse(broadcast.dedup_priority) : []) as string[];
  const preview = await computeDedupBroadcastPreview(
    db,
    accountIds,
    dedupPriority,
    broadcast.target_tag_id ?? null,
  );
  let total = 0;
  for (const a of preview.perAccount) {
    const account = await getLineAccountById(db, a.accountId);
    if (account && account.is_active) total += a.recipients.length;
  }
  return total;
}

export async function processMultiAccountDedupBroadcast(
  db: D1Database,
  broadcast: {
    id: string;
    title?: string | null;
    account_ids: string | null;
    dedup_priority: string | null;
    target_tag_id?: string | null;
    message_type: string;
    message_content: string;
    alt_text?: string | null;
    dedup_progress?: string | null;
    aggregation_unit?: string | null;
    success_count?: number;
  },
  lineClientFactory: (token: string) => LineClient = (t) => new LineClient(t),
  opts: { maxRunMs?: number; now?: () => number; quotaEnv?: QuotaEnv } = {},
): Promise<ProcessMultiAccountDedupResult> {
  const startedAt = (opts.now ?? Date.now)();
  const accountIds = (broadcast.account_ids ? JSON.parse(broadcast.account_ids) : []) as string[];
  const priority = (broadcast.dedup_priority ? JSON.parse(broadcast.dedup_priority) : []) as string[];
  const preview = await computeDedupBroadcastPreview(db, accountIds, priority, broadcast.target_tag_id ?? null);
  return processJournaledDedupBroadcast(db, broadcast, preview, lineClientFactory, { ...opts, startedAt });
}
