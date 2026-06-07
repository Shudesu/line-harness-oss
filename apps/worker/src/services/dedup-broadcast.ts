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
  recipients: Array<{ friendId: string; lineUserId: string; identKey: string }>;
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
    SELECT friend_id, line_user_id, line_account_id, ident_key
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
      })),
    };
  });

  return { totalSelected, uniqueRecipients, reduction, reductionRate, perAccount };
}

import { LineClient, type Message } from '@line-crm/line-sdk';
import { getLineAccountById, jstNow, updateBroadcastLineRequestId } from '@line-crm/db';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import { renderMessageContent } from './render-message.js';
import { buildMessage } from './broadcast.js';
import { buildRetryKey } from '../utils/retry-key.js';

const MULTICAST_BATCH_SIZE = 500;

export interface ProcessMultiAccountDedupResult {
  totalCount: number;
  successCount: number;
  failedAccountIds: string[];
}

/**
 * Send a multi-account-dedup broadcast.
 *
 * Called by processBroadcastSend (in broadcast.ts) when
 * broadcast.target_type === 'multi-account-dedup'. Re-runs
 * computeDedupBroadcastPreview at send time (live data, drift from preview by
 * design) to obtain the per-account recipient list, then for each account:
 *   - skip if account is missing or inactive (not a failure)
 *   - send recipients in 500-friend batches with stagger delays
 *   - log per-friend INSERTs into messages_log
 *   - on multicast exception, log the account in failedAccountIds and continue
 *
 * Persists failedAccountIds to broadcasts.failed_account_ids when non-empty.
 * Status determination ('sent' vs 'failed' vs 'sent + partial') is left to
 * the caller (processBroadcastSend) — see broadcast.ts §7.3.
 */
/**
 * dedup broadcast の resume 用進捗。broadcasts.dedup_progress JSON カラムに保存。
 *
 * sentIdentKeys: dedup の正規化 ID (URL_TOKEN / uid:user_id / solo:friend_id) のうち
 *                既に multicast 済のもの全体集合。**アカウント横断で共有**する。
 *
 * 設計理由:
 *   - per-account の lineUserId 集合だと、resume 時に dedup 勝者が別アカウントに
 *     遷移したケース (account A が unfollow / tag 喪失 → 同じ logical person が
 *     account B で勝者になる) で新しい lineUserId が「未送信扱い」となり、結果
 *     同じ人物に二重配信される。
 *   - identKey は dedup の意味論上ユニークな key なので、横断 set で持てば論理
 *     重複を完全に防げる。
 *
 * 容量見積り: 2000 人 × ~40 文字 (url_token または uid:UUID) = ~80KB。
 * D1 row 1MB 上限内。
 *
 * **スケール限界**: ~25,000 人を超える broadcast では JSON サイズが 1MB を超え、
 * UPDATE が失敗してその時点で resume 機能が止まる (multicast 自体は LINE 側に
 * 届くが、進捗は記録されない → 完了時に重複扱いになる)。それ以上の規模が
 * 必要になったら別テーブル `broadcast_dedup_progress(broadcast_id, ident_key)` に
 * row 単位で持つ設計へ移行すること (現状は対応せず、コメントで明示)。
 *
 * 安全マージン: 2000-5000 人なら問題なし。10000 人で要監視 (~400KB)。
 */
interface DedupProgress {
  sentIdentKeys: string[];
}

function parseProgress(raw: string | null | undefined): DedupProgress {
  const empty: DedupProgress = { sentIdentKeys: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { sentIdentKeys?: unknown }).sentIdentKeys)) {
      return {
        sentIdentKeys: (parsed as { sentIdentKeys: unknown[] }).sentIdentKeys
          .filter((s): s is string => typeof s === 'string'),
      };
    }
  } catch {
    // ignore — corrupt JSON は最初からやり直す
  }
  return empty;
}

export async function processMultiAccountDedupBroadcast(
  db: D1Database,
  broadcast: {
    id: string;
    account_ids: string | null;
    dedup_priority: string | null;
    target_tag_id?: string | null;
    message_type: string;
    message_content: string;
    alt_text?: string | null;
    dedup_progress?: string | null;
    aggregation_unit?: string | null;
  },
  lineClientFactory: (token: string) => LineClient = (t) => new LineClient(t),
): Promise<ProcessMultiAccountDedupResult> {
  const accountIds = (broadcast.account_ids ? JSON.parse(broadcast.account_ids) : []) as string[];
  const dedupPriority = (broadcast.dedup_priority ? JSON.parse(broadcast.dedup_priority) : []) as string[];

  const preview = await computeDedupBroadcastPreview(
    db,
    accountIds,
    dedupPriority,
    broadcast.target_tag_id ?? null,
  );

  // resume 用の進捗を読み込む。crash した前回の途中状態が入っていれば、
  // identKey ベースで既送ぶんを除外して残差だけ送る。
  const progress = parseProgress(broadcast.dedup_progress);
  const sentSet = new Set(progress.sentIdentKeys);

  // totalCount は「この broadcast の意図した audience 全体」= 既送 identKey ∪
  // active アカウントの preview 当選者 identKey。母集団変動 (unfollow / tag 喪失) で
  // current preview から消えた既送ユーザーも intended audience に含めるための union。
  // これがないと resume 時に success_count > total_count になる事故が起きる。
  // inactive account は実送信されないので集計から除外する (active union のみ)。
  const allIdentKeys = new Set<string>(progress.sentIdentKeys);

  const failedAccountIds: string[] = [];

  // 単一 broadcast-wide unit を全アカウント multicast で共有する。各 LINE
  // チャネルは独立した unit namespace を持つので「同じ名前で別カウント」が
  // アカウント側に保持される。fetch-insight 側で account_ids をループして
  // それぞれ getUnitInsight → 合算する設計 (routes/broadcasts.ts の dedup 分岐)。
  //
  // LINE customAggregationUnit は alphanumeric + underscore のみ (1-30 chars)。
  // broadcast.id.slice(0, 8) だと id がハイフン含む形 (例: 'bcast-xxxx-...')
  // のとき 'bcast_bcast-xx' と無効値を生成して LINE が 400 を返す。fallback は
  // hex のみに正規化する。`broadcasts.aggregation_unit` カラムが既に有効な
  // unit で埋まっていれば優先採用する (API/UI 経由作成時はそうなる)。
  const fallbackUnit = `bcast_${broadcast.id.slice(0, 8).replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const unit = broadcast.aggregation_unit ?? fallbackUnit;

  for (const accountResult of preview.perAccount) {
    const account = await getLineAccountById(db, accountResult.accountId);
    if (!account || !account.is_active) {
      console.log(`[multi-account-dedup] skipping inactive/missing account ${accountResult.accountId}`);
      continue;
    }

    const recipients = accountResult.recipients;
    // active account の identKey を totalCount union に登録する (inactive は除外済み)。
    for (const r of recipients) allIdentKeys.add(r.identKey);
    if (recipients.length === 0) continue;

    // 既に送信済の identKey を持つ recipient を除外して残差だけ送る。
    // identKey は dedup の意味論的 ID なので、母集団変動や cross-account 遷移が
    // あっても論理重複を完全に防げる。
    const remaining = recipients.filter((r) => !sentSet.has(r.identKey));
    if (remaining.length === 0) continue; // このアカに残作業なし

    const client = lineClientFactory(account.channel_access_token);
    const totalBatches = Math.ceil(remaining.length / MULTICAST_BATCH_SIZE);

    // Per-account の liff_id でテンプレ変数 ({{liff_id}}) を置換してから
    // buildMessage する。これで 1 broadcast から複数アカへ配信する際、
    // 友だちの所属アカに対応した LIFF URL が届く (events の運用要件)。
    const renderedContent = renderMessageContent(
      broadcast.message_content,
      (account as unknown as { liff_id?: string | null }).liff_id ?? null,
    );
    const message = buildMessage(broadcast.message_type, renderedContent, broadcast.alt_text ?? undefined);

    try {
      for (let i = 0; i < remaining.length; i += MULTICAST_BATCH_SIZE) {
        const batchIdx = Math.floor(i / MULTICAST_BATCH_SIZE);
        const batch = remaining.slice(i, i + MULTICAST_BATCH_SIZE);

        if (batchIdx > 0) {
          await sleep(calculateStaggerDelay(remaining.length, batchIdx));
        }

        let batchMessage = message;
        if (message.type === 'text' && totalBatches > 1) {
          batchMessage = { ...message, text: addMessageVariation(message.text, batchIdx) } as Message;
        }

        // P1 (2026-06-07): X-Line-Retry-Key で resume race の二重配信防止。
        // account ID と batch index を入れて per-account batch ごとにユニーク化。
        const retryKey = await buildRetryKey(
          `broadcast:${broadcast.id}:dedup:${account.id}:${i}`,
        );
        await client.multicast(batch.map((r) => r.lineUserId), [batchMessage], [unit], retryKey);

        // multicast 成功直後に identKey を sent set へ追加。
        for (const r of batch) {
          progress.sentIdentKeys.push(r.identKey);
          sentSet.add(r.identKey);
        }

        const now = jstNow();
        // messages_log INSERT と progress UPDATE を 1 batch にまとめてアトミックに
        // 永続化する。Worker が multicast 後・batch 完了前に死ぬと「LINE 配信済 +
        // DB 進捗未更新」になって resume 時に同 batch を再送 → 重複配信事故が起きる。
        // db.batch は D1 で transaction として扱われ、まとめて成否が決まる。
        const stmts = [
          ...batch.map((r) =>
            db.prepare(
              `INSERT INTO messages_log
                (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
            ).bind(crypto.randomUUID(), r.friendId, broadcast.message_type, broadcast.message_content, broadcast.id, account.id, now),
          ),
          // success_count は absolute (`= ?`) で書いて double-counting を防ぐ。
          db.prepare(
            `UPDATE broadcasts SET dedup_progress = ?, success_count = ? WHERE id = ?`,
          ).bind(JSON.stringify(progress), progress.sentIdentKeys.length, broadcast.id),
        ];
        await db.batch(stmts);
      }
    } catch (err) {
      console.error(`[multi-account-dedup] account ${account.id} failed:`, err);
      failedAccountIds.push(account.id);
    }
  }

  // failed_account_ids は常に上書きする。前回 stalled run で残った古い失敗リストを
  // resume 後の成功で上書きしないと「全件成功したのに UI が partial-failure 表示」に
  // なる。今回失敗が無ければ NULL に戻して clean state にする。
  await db.prepare(
    `UPDATE broadcasts SET failed_account_ids = ? WHERE id = ?`,
  ).bind(failedAccountIds.length > 0 ? JSON.stringify(failedAccountIds) : null, broadcast.id).run();

  const successCount = progress.sentIdentKeys.length;
  const totalCount = allIdentKeys.size;

  // aggregation_unit を保存して fetch-insight が LINE Insight API を叩けるようにする。
  // 1 件以上送れたときだけ書く (全件失敗時は insight 取得しても意味ない)。
  if (successCount > 0) {
    await updateBroadcastLineRequestId(db, broadcast.id, null, unit);
  }

  // dedup_progress の clear は意図的にここでは行わない。caller (processQueuedBroadcastBatches
  // など) が updateBroadcastStatus(broadcast.id, 'sent', ...) を呼ぶときに同一 UPDATE で
  // clear される設計 (db/broadcasts.ts: updateBroadcastStatus 参照)。
  // この関数の return 後・status='sent' 確定前に Worker crash した場合は dedup_progress
  // が残ったままで status='sending', batch_offset=-1 になり、recoverStalledBroadcasts が
  // 再投入して resume → 完走済みアカは batchOffset >= recipients.length で skip → 重複なし。
  return { totalCount, successCount, failedAccountIds };
}
