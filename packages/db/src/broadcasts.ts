import { jstNow } from './utils.js';
export type BroadcastTargetType = 'all' | 'tag' | 'multi-account-dedup';
export type BroadcastStatus = 'draft' | 'scheduled' | 'sending' | 'sent';
export type BroadcastMessageType = 'text' | 'image' | 'flex';

export interface Broadcast {
  id: string;
  title: string;
  message_type: BroadcastMessageType;
  message_content: string;
  target_type: BroadcastTargetType;
  target_tag_id: string | null;
  status: BroadcastStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  total_count: number;
  success_count: number;
  created_at: string;
  account_ids: string | null;
  dedup_priority: string | null;
  failed_account_ids: string | null;
  dedup_progress: string | null;
  batch_lock_at: string | null;
  track_links: number;
}

export async function getBroadcasts(db: D1Database, accountId?: string): Promise<Broadcast[]> {
  let sql = `SELECT b.*,
       bi.status as insight_status,
       bi.open_rate, bi.click_rate
FROM broadcasts b
LEFT JOIN broadcast_insights bi ON b.id = bi.broadcast_id
  AND bi.id = (SELECT id FROM broadcast_insights WHERE broadcast_id = b.id ORDER BY created_at DESC LIMIT 1)`;
  const params: unknown[] = [];
  if (accountId) {
    // Include:
    //   1. per-account broadcasts whose line_account_id matches (existing behavior)
    //   2. multi-account-dedup broadcasts whose account_ids JSON array contains
    //      the selected account (account_ids is null for legacy/non-dedup paths
    //      so the EXISTS short-circuits safely).
    sql += ` WHERE (
      b.line_account_id = ?
      OR (
        b.target_type = 'multi-account-dedup'
        AND b.account_ids IS NOT NULL
        AND EXISTS (SELECT 1 FROM json_each(b.account_ids) WHERE value = ?)
      )
    )`;
    params.push(accountId, accountId);
  }
  sql += ` ORDER BY COALESCE(b.sent_at, b.scheduled_at, b.created_at) DESC`;
  const result = params.length > 0
    ? await db.prepare(sql).bind(...params).all<Broadcast>()
    : await db.prepare(sql).all<Broadcast>();
  return result.results;
}

export async function getBroadcastById(
  db: D1Database,
  id: string,
): Promise<Broadcast | null> {
  return db
    .prepare(
      `SELECT b.*,
       bi.id as insight_id, bi.delivered, bi.unique_impression,
       bi.unique_click, bi.unique_media_played,
       bi.open_rate, bi.click_rate, bi.status as insight_status,
       bi.retry_count, bi.fetched_at as insight_fetched_at,
       bi.created_at as insight_created_at
FROM broadcasts b
LEFT JOIN broadcast_insights bi ON b.id = bi.broadcast_id
WHERE b.id = ?`,
    )
    .bind(id)
    .first<Broadcast>();
}

export interface CreateBroadcastInput {
  title: string;
  messageType: BroadcastMessageType;
  messageContent: string;
  targetType: BroadcastTargetType;
  targetTagId?: string | null;
  scheduledAt?: string | null;
  accountIds?: string[];
  dedupPriority?: string[];
  trackLinks?: boolean;
}

export async function createBroadcast(
  db: D1Database,
  input: CreateBroadcastInput,
): Promise<Broadcast> {
  const id = crypto.randomUUID();
  const now = jstNow();

  const initialStatus: BroadcastStatus = input.scheduledAt ? 'scheduled' : 'draft';

  await db
    .prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, target_tag_id, status, scheduled_at, sent_at, total_count, success_count, account_ids, dedup_priority, track_links, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 0, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.title,
      input.messageType,
      input.messageContent,
      input.targetType,
      input.targetTagId ?? null,
      initialStatus,
      input.scheduledAt ?? null,
      input.accountIds ? JSON.stringify(input.accountIds) : null,
      input.dedupPriority ? JSON.stringify(input.dedupPriority) : null,
      input.trackLinks === false ? 0 : 1,
      now,
    )
    .run();

  return (await getBroadcastById(db, id))!;
}

export type UpdateBroadcastInput = Partial<
  Pick<
    Broadcast,
    | 'title'
    | 'message_type'
    | 'message_content'
    | 'target_type'
    | 'target_tag_id'
    | 'status'
    | 'scheduled_at'
    | 'track_links'
  >
>;

export async function updateBroadcast(
  db: D1Database,
  id: string,
  updates: UpdateBroadcastInput,
): Promise<Broadcast | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.message_type !== undefined) {
    fields.push('message_type = ?');
    values.push(updates.message_type);
  }
  if (updates.message_content !== undefined) {
    fields.push('message_content = ?');
    values.push(updates.message_content);
  }
  if (updates.target_type !== undefined) {
    fields.push('target_type = ?');
    values.push(updates.target_type);
  }
  if (updates.target_tag_id !== undefined) {
    fields.push('target_tag_id = ?');
    values.push(updates.target_tag_id);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.scheduled_at !== undefined) {
    fields.push('scheduled_at = ?');
    values.push(updates.scheduled_at);
  }
  if (updates.track_links !== undefined) {
    fields.push('track_links = ?');
    values.push(updates.track_links ? 1 : 0);
  }

  if (fields.length > 0) {
    values.push(id);
    await db
      .prepare(`UPDATE broadcasts SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  return getBroadcastById(db, id);
}

export async function deleteBroadcast(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM broadcasts WHERE id = ?`).bind(id).run();
}

export async function createBroadcastInsight(
  db: D1Database,
  broadcastId: string,
): Promise<void> {
  // Idempotent: dedup broadcast の resume 時など、この関数が同じ broadcastId に
  // 対して複数回呼ばれうる。broadcast_insights.broadcast_id に UNIQUE 制約がない
  // ため `INSERT` 単体だと重複行が生まれ、getBroadcastById の LEFT JOIN や
  // /insight ルートが古い pending 行を拾って表示が壊れる。
  // 既存行があれば skip する SELECT-then-INSERT パターンに変更。
  const existing = await db
    .prepare(`SELECT id FROM broadcast_insights WHERE broadcast_id = ? LIMIT 1`)
    .bind(broadcastId)
    .first<{ id: string }>();
  if (existing) return;

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO broadcast_insights (id, broadcast_id, status) VALUES (?, ?, 'pending')`,
    )
    .bind(id, broadcastId)
    .run();
}

export async function updateBroadcastLineRequestId(
  db: D1Database,
  broadcastId: string,
  lineRequestId: string | null,
  aggregationUnit: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcasts SET line_request_id = ?, aggregation_unit = ? WHERE id = ?`,
    )
    .bind(lineRequestId, aggregationUnit, broadcastId)
    .run();
}

export async function getPendingInsights(
  db: D1Database,
): Promise<
  Array<{
    insightId: string;
    broadcastId: string;
    lineRequestId: string | null;
    aggregationUnit: string | null;
    sentAt: string;
    retryCount: number;
    lineAccountId: string | null;
    targetType: string | null;
    accountIds: string[] | null;
    failedAccountIds: string[] | null;
    successCount: number | null;
  }>
> {
  const result = await db
    .prepare(
      `SELECT bi.id as insight_id, bi.broadcast_id, bi.retry_count,
              b.line_request_id, b.aggregation_unit, b.sent_at, b.line_account_id,
              b.target_type, b.account_ids, b.failed_account_ids, b.success_count
       FROM broadcast_insights bi
       JOIN broadcasts b ON bi.broadcast_id = b.id
       WHERE bi.status = 'pending'
         AND b.sent_at IS NOT NULL
         AND julianday('now', '+9 hours') - julianday(b.sent_at) >= 3`,
    )
    .all();
  const parseArr = (v: unknown): string[] | null => {
    if (!v) return null;
    if (Array.isArray(v)) return v as string[];
    if (typeof v !== 'string') return null;
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as string[]) : null;
    } catch {
      return null;
    }
  };
  return (result.results || []).map((r: Record<string, unknown>) => ({
    insightId: r.insight_id as string,
    broadcastId: r.broadcast_id as string,
    lineRequestId: r.line_request_id as string | null,
    aggregationUnit: r.aggregation_unit as string | null,
    sentAt: r.sent_at as string,
    retryCount: r.retry_count as number,
    lineAccountId: r.line_account_id as string | null,
    targetType: (r.target_type as string | null) ?? null,
    accountIds: parseArr(r.account_ids),
    failedAccountIds: parseArr(r.failed_account_ids),
    successCount: (r.success_count as number | null) ?? null,
  }));
}

export async function updateInsightResult(
  db: D1Database,
  insightId: string,
  result: {
    delivered: number | null;
    uniqueImpression: number | null;
    uniqueClick: number | null;
    uniqueMediaPlayed: number | null;
    rawResponse: string;
  },
): Promise<void> {
  const openRate =
    result.delivered && result.uniqueImpression
      ? result.uniqueImpression / result.delivered
      : null;
  const clickRate =
    result.delivered && result.uniqueClick
      ? result.uniqueClick / result.delivered
      : null;
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `UPDATE broadcast_insights
       SET delivered = ?, unique_impression = ?, unique_click = ?,
           unique_media_played = ?, open_rate = ?, click_rate = ?,
           raw_response = ?, status = 'ready', fetched_at = ?
       WHERE id = ?`,
    )
    .bind(
      result.delivered,
      result.uniqueImpression,
      result.uniqueClick,
      result.uniqueMediaPlayed,
      openRate,
      clickRate,
      result.rawResponse,
      now,
      insightId,
    )
    .run();
}

export async function markInsightFailed(
  db: D1Database,
  insightId: string,
  retryCount: number,
): Promise<void> {
  const newStatus = retryCount >= 2 ? 'failed' : 'pending';
  await db
    .prepare(
      `UPDATE broadcast_insights SET retry_count = ?, status = ? WHERE id = ?`,
    )
    .bind(retryCount + 1, newStatus, insightId)
    .run();
}

export async function getQueuedBroadcasts(db: D1Database): Promise<Broadcast[]> {
  // Pick up broadcasts explicitly queued for batch processing:
  //   - segment_conditions IS NOT NULL: tag/segment queued batches
  //   - account_ids IS NOT NULL: multi-account-dedup queued batches
  // batch_offset >= 0: ロック中（-1）のものは除外
  // sent_at IS NULL: 完了済みは除外
  const result = await db
    .prepare(
      `SELECT * FROM broadcasts WHERE status = 'sending' AND batch_offset >= 0 AND sent_at IS NULL AND (segment_conditions IS NOT NULL OR account_ids IS NOT NULL) ORDER BY created_at ASC`,
    )
    .all<Broadcast>();
  return result.results;
}

/**
 * ロック解除: batch_offset=-1 のまま停滞したブロードキャストを復旧する。
 *
 * 2 系統 (idempotency 保護の有無で revoke 閾値を変える):
 * 1) 未着手 (success_count=0): segment / multi-account-dedup どちらでも、batch_offset=0 に
 *    戻して次の cron で再投入する。まだ送信実績が無く重複防止情報も無いため、最初の
 *    multicast / 最初の per-batch write が in-flight の間に revoke すると最初の 500 人を
 *    二重送信し得る。「Worker が確実に死んでいる」と言える長め (30分) の閾値を使う。
 * 2) multi-account-dedup の途中停滞 (success_count > 0 かつ dedup_progress あり):
 *    dedup_progress が sentIdentKeys を保持するので再投入しても既送は skip され二重送信
 *    しない (idempotent)。dedup は分割送信 (chunking) で 1 chunk あたり高々 ~15s しか
 *    -1 ロックを保持しないので、3分以上 -1 のまま = その chunk を実行していた Worker は
 *    既に死んでいる、と安全に判定できる。よって短い (3分) 閾値で素早く crash recovery
 *    してよい。success_count > 0 だが dedup_progress=NULL の row (resume 機能 deploy 前の
 *    停滞 / 030 migration 直後の在庫) は ID 集合が無く安全に再開できないため両系統とも
 *    対象外にし、手動対応 (D1 で sent に書き換え等) に委ねる。
 */
export async function recoverStalledBroadcasts(db: D1Database): Promise<void> {
  // 進捗ゼロ (success_count=0) の lock 用。idempotency 保護が無いので長め。0.021日 ≈ 30分。
  const STALL_LOCK_REVOKE_DAYS_NO_PROGRESS = 0.021;
  // dedup_progress あり (success_count>0) の再開可能 lock 用。chunking で 1 実行が短いため
  // 安全に短くできる。0.0021日 ≈ 3.0分。cron 間隔(5分)より短いので次の tick で resume。
  const STALL_LOCK_REVOKE_DAYS_RESUMABLE = 0.0021;
  // 1) 未着手 (segment / dedup どちらも対象)
  //    閾値は batch_lock_at (= ロック取得時刻) のみ。created_at にフォールバック
  //    すると jstNow() の `+09:00` suffix で 9 時間ズレるバグが出るので使わない。
  //    マイグレーション 031 で在庫 row には batch_lock_at が backfill 済み。
  await db
    .prepare(
      `UPDATE broadcasts SET batch_offset = 0, batch_lock_at = NULL
       WHERE status = 'sending' AND batch_offset = -1
       AND sent_at IS NULL AND success_count = 0
       AND (segment_conditions IS NOT NULL OR account_ids IS NOT NULL)
       AND batch_lock_at IS NOT NULL
       AND julianday('now', '+9 hours') - julianday(batch_lock_at) > ${STALL_LOCK_REVOKE_DAYS_NO_PROGRESS}`,
    )
    .run();

  // 2) dedup の途中停滞 (success_count > 0 かつ dedup_progress あり) — idempotent に
  //    再開できる row だけを短い閾値で素早く resume する。success_count=0 の row は
  //    系統 1) が長い閾値で扱う。success_count > 0 だが dedup_progress=NULL のケース
  //    (resume 機能 deploy 前の停滞 / 030 migration 直後の在庫) は ID 集合が無く安全な
  //    再開ができず、resume すると全件再送 → 重複配信事故になるため両系統とも対象外。
  //
  //    閾値は batch_lock_at (= ロック取得時刻) のみ。created_at にフォールバック
  //    すると jstNow() の `+09:00` suffix で 9 時間ズレるバグが出るので使わない。
  //    マイグレーション 031 で在庫 row には batch_lock_at が backfill 済み。
  await db
    .prepare(
      `UPDATE broadcasts SET batch_offset = 0, batch_lock_at = NULL
       WHERE status = 'sending' AND batch_offset = -1
       AND sent_at IS NULL
       AND target_type = 'multi-account-dedup'
       AND success_count > 0 AND dedup_progress IS NOT NULL
       AND batch_lock_at IS NOT NULL
       AND julianday('now', '+9 hours') - julianday(batch_lock_at) > ${STALL_LOCK_REVOKE_DAYS_RESUMABLE}`,
    )
    .run();
}

export async function updateBroadcastBatchProgress(
  db: D1Database,
  id: string,
  batchOffset: number,
  additionalSuccess: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE broadcasts SET batch_offset = ?, success_count = success_count + ? WHERE id = ?`,
    )
    .bind(batchOffset, additionalSuccess, id)
    .run();
}

export interface BroadcastStatusCounts {
  totalCount?: number;
  successCount?: number;
}

export async function updateBroadcastStatus(
  db: D1Database,
  id: string,
  status: BroadcastStatus,
  counts?: BroadcastStatusCounts,
): Promise<void> {
  const fields: string[] = ['status = ?'];
  const values: unknown[] = [status];

  if (status === 'sent') {
    fields.push('sent_at = ?');
    values.push(jstNow());
    // 完了マーカー: dedup_progress を NULL に戻して resume ロジックを無効化する。
    // processMultiAccountDedupBroadcast 内で別 UPDATE として clear すると status='sent'
    // との間で race window が生まれ、その間に Worker crash すると recover 経路が
    // dedup_progress=NULL のまま再投入して全件再送 → 重複配信事故の元になる。
    // status='sent' と同一 UPDATE で原子的に clear する。
    fields.push('dedup_progress = NULL');
    // batch_lock_at もクリア (sent 後は recover の対象外なので影響はないが綺麗に).
    fields.push('batch_lock_at = NULL');
  }
  // 注: status='draft' では dedup_progress / batch_lock_at をクリアしない。
  // 失敗 rollback (processBroadcastSend の catch) で draft に戻すケースで partial
  // state を捨てると、次回 retry が全件再送 → 重複配信事故になる。resume を成立
  // させるには partial state を保持する必要がある。
  // 「ユーザーが draft を編集して送り直す」場合の clean reset は別途 PUT API 側で
  // 明示的に対応する設計にする (現状未実装。必要になったら追加)。
  if (counts?.totalCount !== undefined) {
    fields.push('total_count = ?');
    values.push(counts.totalCount);
  }
  if (counts?.successCount !== undefined) {
    fields.push('success_count = ?');
    values.push(counts.successCount);
  }

  values.push(id);
  await db
    .prepare(`UPDATE broadcasts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function updateBroadcastFailedAccountIds(
  db: D1Database,
  broadcastId: string,
  failedAccountIds: string[],
): Promise<void> {
  await db.prepare(`UPDATE broadcasts SET failed_account_ids = ? WHERE id = ?`)
    .bind(JSON.stringify(failedAccountIds), broadcastId)
    .run();
}
