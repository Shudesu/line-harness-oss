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

import { LineClient, type Message } from '@line-crm/line-sdk';
import { getLineAccountById, jstNow, updateBroadcastLineRequestId, setBroadcastLastError } from '@line-crm/db';
import { getLinePlanQuotaShortfall, notifyQuotaAlert } from './quota-alert.js';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import {
  assertNoUnresolvedBroadcastVariables,
  hasRecipientVariables,
  renderBroadcastMessageContent,
} from './render-message.js';
import { buildMessage } from './broadcast.js';
import { createBroadcastRetryKey } from './broadcast-retry-key.js';
import { isQuotaExceeded, type QuotaEnv } from './quota.js';

const MULTICAST_BATCH_SIZE = 500;
const PERSONALIZED_PUSH_BATCH_SIZE = 10;

export interface ProcessMultiAccountDedupResult {
  totalCount: number;
  successCount: number;
  failedAccountIds: string[];
  // クォータ不足でスキップしたアカウントの要約 (last_error 用)。無ければ null。
  // caller は status='sent' 遷移 (last_error が clear される) の後にこれを
  // last_error へ書き戻す。
  quotaSkippedSummary: string | null;
  // false = この実行は時間バジェットに達して途中で yield した (まだ未送の人が残る)。
  // caller は status='sent' にせず batch_offset=0 に戻して次の cron tick に継続させる。
  // true = 全 account を送り切った (= 完了)。caller が status='sent' にする。
  complete: boolean;
}

// 1 回の cron 実行でこの時間 (ms) を超えたら、残りは次の tick に回して yield する。
// これにより 1 実行が常に短く終わり、Cloudflare Worker の時間制限に達して stall する
// ことが構造的に無くなる (5000 人でも数 tick に分割されて淡々と進む)。stagger sleep も
// この経過時間に含まれる。判定は次 batch の sleep+multicast の「前」に行うため、超過判定
// 時点から更に 1 batch 分 (最大 ~5s sleep + multicast) はみ出し得る。それを見込んで Worker
// CPU 制限 (約30s) に対し十分な余裕を取った 10s に設定する (実効ロック保持は最大 ~15-18s)。
const MAX_RUN_MS = 10_000;

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
  /**
   * この broadcast で既にクォータ不足通知を出したアカウント ID。
   * multi-tick resume (timeExceeded → 次 cron tick で再入場) では不足アカウントが
   * 毎 tick 再評価されるため、これが無いと dedup なしの 'pre-send' 通知が tick
   * ごとに連打される (1時間かかる配信で ~12 重複 Slack 通知)。クォータの再チェック
   * 自体は毎 tick 行う — 配信中に追加購入されたら当該アカウントも再開できる。
   */
  quotaNotifiedAccountIds?: string[];
}

function parseProgress(raw: string | null | undefined): DedupProgress {
  const empty: DedupProgress = { sentIdentKeys: [] };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { sentIdentKeys?: unknown }).sentIdentKeys)) {
      const notified = (parsed as { quotaNotifiedAccountIds?: unknown }).quotaNotifiedAccountIds;
      return {
        sentIdentKeys: (parsed as { sentIdentKeys: unknown[] }).sentIdentKeys
          .filter((s): s is string => typeof s === 'string'),
        ...(Array.isArray(notified)
          ? { quotaNotifiedAccountIds: notified.filter((s): s is string => typeof s === 'string') }
          : {}),
      };
    }
  } catch {
    // ignore — corrupt JSON は最初からやり直す
  }
  return empty;
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
  },
  lineClientFactory: (token: string) => LineClient = (t) => new LineClient(t),
  opts: { maxRunMs?: number; now?: () => number; quotaEnv?: QuotaEnv } = {},
): Promise<ProcessMultiAccountDedupResult> {
  // 時間バジェット制御 (テストでは clock を注入して yield を決定的に再現できる)。
  // 変数名は clock — batch ループ内の `const now = jstNow()` (timestamp 文字列) と
  // 衝突させないため。
  const clock = opts.now ?? (() => Date.now());
  const maxRunMs = opts.maxRunMs ?? MAX_RUN_MS;
  const startMs = clock();
  // 1 batch でも送ったら true。時間切れでも最低 1 batch は進めて前進を保証する
  // (毎 tick 必ず success_count が伸びる → 永久に同じ所で足踏みしない)。
  let sentAnyBatch = false;
  let timeExceeded = false;

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
  // クォータ不足でスキップしたアカウント (failed_account_ids に加えて last_error に
  // 理由を残すため別トラック)。
  const quotaSkippedAccounts: Array<{
    id: string;
    name: string | null;
    shortfall: { remaining: number; audience: number };
  }> = [];

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
    if (timeExceeded) break; // 時間バジェット超過 — 残アカウントは次の cron tick で処理
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

    // LINE プランクォータの送信前ガード (2026-09-01 事故 — 複数アカウント一斉配信で
    // 一部アカウントがクォータ不足のまま送信して全滅した形そのもの)。このアカウントの
    // 残差 (remaining) を賄えなければ、そのアカウントだけスキップして failed に記録し、
    // 他アカウントの配信は続行する。resume 時も残差基準で再評価される。
    // クォータ確認 API の失敗は fail-open (getLinePlanQuotaShortfall 内)。
    const planShortfall = await getLinePlanQuotaShortfall(client, remaining.length);
    if (planShortfall) {
      console.error(
        `[multi-account-dedup] account ${account.id} skipped: plan quota insufficient ` +
        `(remaining=${planShortfall.remaining} audience=${remaining.length})`,
      );
      failedAccountIds.push(account.id);
      quotaSkippedAccounts.push({ id: account.id, name: account.name, shortfall: planShortfall });
      // 通知はこの broadcast につきアカウントごとに1回だけ。multi-tick resume では
      // 不足アカウントが毎 tick ここを通るため、進捗 JSON に通知済みを永続化しないと
      // dedup なしの 'pre-send' 通知が tick ごとに連打される (DedupProgress 参照)。
      const notifiedIds = new Set(progress.quotaNotifiedAccountIds ?? []);
      if (!notifiedIds.has(account.id)) {
        await notifyQuotaAlert(db, {
          lineAccountId: account.id,
          accountName: account.name,
          shortfall: planShortfall,
          source: 'pre-send',
          broadcastId: broadcast.id,
          broadcastTitle: broadcast.title ?? undefined,
        });
        notifiedIds.add(account.id);
        progress.quotaNotifiedAccountIds = [...notifiedIds];
        await db.prepare(
          `UPDATE broadcasts SET dedup_progress = ? WHERE id = ?`,
        ).bind(JSON.stringify(progress), broadcast.id).run();
      }
      continue;
    }

    const accountContent = renderBroadcastMessageContent(
      broadcast.message_type,
      broadcast.message_content,
      { liffId: (account as unknown as { liff_id?: string | null }).liff_id ?? null },
    );
    const personalized = hasRecipientVariables(accountContent);
    if (!personalized) assertNoUnresolvedBroadcastVariables(accountContent);
    const deliveryBatchSize = personalized ? PERSONALIZED_PUSH_BATCH_SIZE : MULTICAST_BATCH_SIZE;
    const totalBatches = Math.ceil(remaining.length / deliveryBatchSize);

    // Per-account の liff_id でテンプレ変数 ({{liff_id}}) を置換してから
    // buildMessage する。これで 1 broadcast から複数アカへ配信する際、
    // 友だちの所属アカに対応した LIFF URL が届く (events の運用要件)。
    const message = personalized
      ? null
      : buildMessage(broadcast.message_type, accountContent, broadcast.alt_text ?? undefined);

    try {
      for (let i = 0; i < remaining.length; i += deliveryBatchSize) {
        const batchIdx = Math.floor(i / deliveryBatchSize);
        const batch = remaining.slice(i, i + deliveryBatchSize);

        // 時間バジェットを超えたら、残りは次の cron tick に回して yield する。
        // ただし最低 1 batch は必ず送る (sentAnyBatch ガード) ことで毎 tick 前進を保証。
        if (sentAnyBatch && clock() - startMs > maxRunMs) {
          timeExceeded = true;
          break;
        }

        // 使用量上限の再チェックも同じ安全境界で行う (直前 batch までの進捗は
        // db.batch で durable 済み)。超過していたら時間バジェットと同じ経路で
        // yield し (complete=false → caller が batch_offset を戻す)、1 実行の
        // はみ出しを最大 1 batch に抑える。上限内に戻った tick で resume する。
        // 前進保証 (sentAnyBatch) は付けない: 超過中は 1 batch も送らないのが正。
        if (opts.quotaEnv && (await isQuotaExceeded(db, opts.quotaEnv))) {
          timeExceeded = true;
          break;
        }

        if (batchIdx > 0) {
          await sleep(calculateStaggerDelay(remaining.length, batchIdx));
        }

        const delivered = [] as Array<{
          recipient: (typeof batch)[number];
          messageType: string;
          content: string;
        }>;
        let batchDeliveryError: unknown = null;
        if (personalized) {
          for (const recipient of batch) {
            try {
              const content = renderBroadcastMessageContent(broadcast.message_type, accountContent, {
                displayName: recipient.displayName,
              });
              assertNoUnresolvedBroadcastVariables(content);
              const recipientMessage = buildMessage(
                broadcast.message_type,
                content,
                broadcast.alt_text ?? undefined,
              );
              const retryKey = await createBroadcastRetryKey(
                broadcast.id,
                'dedup-personalized-push',
                recipient.friendId,
                broadcast.message_type,
                content,
              );
              await client.pushMessage(recipient.lineUserId, [recipientMessage], retryKey, [unit]);
              delivered.push({ recipient, messageType: broadcast.message_type, content });
            } catch (err) {
              batchDeliveryError = err;
              break;
            }
          }
        } else {
          let batchMessage = message!;
          if (batchMessage.type === 'text' && totalBatches > 1) {
            batchMessage = { ...batchMessage, text: addMessageVariation(batchMessage.text, batchIdx) } as Message;
          }
          const retryKey = await createBroadcastRetryKey(
            broadcast.id,
            'dedup-multicast',
            account.id,
            ...batch.map((r) => r.identKey),
            JSON.stringify(batchMessage),
          );
          await client.multicast(batch.map((r) => r.lineUserId), [batchMessage], [unit], retryKey);
          for (const recipient of batch) {
            delivered.push({
              recipient,
              messageType: broadcast.message_type,
              content: accountContent,
            });
          }
        }

        // multicast 成功直後に identKey を sent set へ追加。
        for (const { recipient: r } of delivered) {
          progress.sentIdentKeys.push(r.identKey);
          sentSet.add(r.identKey);
        }

        const now = jstNow();
        // messages_log INSERT と progress UPDATE を 1 batch にまとめてアトミックに
        // 永続化する。Worker が multicast 後・batch 完了前に死ぬと「LINE 配信済 +
        // DB 進捗未更新」になって resume 時に同 batch を再送 → 重複配信事故が起きる。
        // db.batch は D1 で transaction として扱われ、まとめて成否が決まる。
        const stmts = [
          ...delivered.map(({ recipient: r, messageType, content }) =>
            db.prepare(
              `INSERT INTO messages_log
                (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
            ).bind(crypto.randomUUID(), r.friendId, messageType, content, broadcast.id, account.id, now),
          ),
          // success_count は absolute (`= ?`) で書いて double-counting を防ぐ。
          db.prepare(
            `UPDATE broadcasts SET dedup_progress = ?, success_count = ? WHERE id = ?`,
          ).bind(JSON.stringify(progress), progress.sentIdentKeys.length, broadcast.id),
        ];
        await db.batch(stmts);
        sentAnyBatch = true; // 1 batch 以上 durable に記録した → 前進保証 & yield 可
        if (batchDeliveryError) throw batchDeliveryError;
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

  // クォータ不足でスキップしたアカウントがあれば理由を last_error に残す
  // (failed_account_ids は「どのアカが失敗したか」だけで理由を持てない)。
  // 完了時は caller が status='sent' で last_error を clear した後に
  // quotaSkippedSummary から書き戻す (途中 yield 時のためここでも書いておく)。
  let quotaSkippedSummary: string | null = null;
  if (quotaSkippedAccounts.length > 0) {
    const detail = quotaSkippedAccounts
      .map((a) => `${a.name || a.id} (残り${a.shortfall.remaining}通 < 対象${a.shortfall.audience}人)`)
      .join('、');
    quotaSkippedSummary = `LINEプラン月間クォータ不足のため一部アカウントをスキップ: ${detail}`;
    await setBroadcastLastError(db, broadcast.id, quotaSkippedSummary);
  }

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
  //
  // complete=false (timeExceeded) のときは caller が status='sent' にせず batch_offset=0 に
  // 戻し、次の cron tick が getQueuedBroadcasts で拾って残りを送る (= 分割送信)。
  return { totalCount, successCount, failedAccountIds, quotaSkippedSummary, complete: !timeExceeded };
}
