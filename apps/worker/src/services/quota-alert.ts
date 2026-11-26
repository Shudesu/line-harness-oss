/**
 * LINE プラン月間クォータ不足の検知・通知
 *
 * 2026-09-01 の一斉配信事故 (2アカウントがクォータ不足で全滅・誰も気づけず)
 * への恒久対応。検知点は3つ:
 *   1. cron 監視 (ban-monitor.ts) — 定期チェック (毎時)
 *   2. 送信前ガード (broadcast.ts / dedup-broadcast.ts) — 一括送信の直前チェック
 *   3. プロキシ経由の一斉送信 (routes/line-proxy.ts) — 外部 MCP/SDK クライアントの
 *      broadcast/multicast パススルー (送信前チェック + LINE 由来 429 の検知)
 * いずれも本モジュールの notifyQuotaAlert で通知に合流する。
 *
 * 通知チャネル:
 *   - notifications テーブル (dashboard 行 + 有効な notification_rules のチャネル)
 *     GET /api/notifications から参照できる記録。通知ルール未設定でも必ず残す。
 *   - outgoing webhooks (event-bus) — event_type 'quota_alert' (または '*') を
 *     購読する外部 Webhook (Slack 連携等) へ実際にプッシュされる能動経路。
 *
 * dedup: cron 監視 (health-check) 由来は同一アカウントにつき JST 月1回。
 * LINE のクォータは月初にリセットされるため月替わりで自然に再武装される。
 * pre-send (配信を実際に中止した) 通知は dedup しない — 中止は毎回オペレーターの
 * 操作/予約に紐づく具体的な事象で、握りつぶすと「配信が silent に draft へ落ちた」
 * という事故の再演になる。頻度は送信試行回数で自然に抑制される (中止された
 * broadcast は draft に戻り、自動リトライはされない)。
 * proxy-* 由来は同一アカウントにつき1時間に1回 — プロキシの呼び出し元は外部の
 * 自動クライアントで、429 を受けて機械的にリトライし得る (pre-send と違い試行
 * 回数で抑制されない) ため、時間 dedup で通知爆撃を防ぐ。
 */

import {
  createNotification,
  hasNotificationSince,
  getActiveNotificationRulesByEvent,
  getActiveOutgoingWebhooksByEvent,
  toJstString,
} from '@line-crm/db';
import { LineApiError } from '@line-crm/line-sdk';
import { monthStartJst } from './quota.js';
import { fireOutgoingWebhooks } from './event-bus.js';

export const QUOTA_ALERT_EVENT = 'quota_alert';

/** 送信前ガードがクォータ不足で送信を中止したことを表す typed error。 */
export class LinePlanQuotaError extends Error {
  constructor(public readonly shortfall: PlanQuotaShortfall) {
    super(
      `line_plan_quota_insufficient: remaining=${shortfall.remaining} audience=${shortfall.audience}`,
    );
    this.name = 'LinePlanQuotaError';
  }
}

/** getMessageQuota / getMessageQuotaConsumption だけを要求する最小クライアント面。 */
export interface PlanQuotaClient {
  getMessageQuota(): Promise<{ type: string; value?: number }>;
  getMessageQuotaConsumption(): Promise<{ totalUsage: number }>;
}

export interface PlanQuotaShortfall {
  limit: number;
  consumption: number;
  remaining: number;
  audience: number;
}

/** LINE が月間上限超過の 429 で返す message (一字一句この文言)。 */
export const LINE_MONTHLY_LIMIT_MESSAGE = 'You have reached your monthly limit.';

/**
 * LINE 由来の「月間クォータ超過」429 か。worker 内部の送信経路 (broadcast.ts) が
 * ガード通過後の上流 429 を検知して last_error + 通知に落とすための判別。
 * LINE がこの文言を変えたら検知は落ちる (通知が消えるだけで送信自体は従来どおり
 * エラー処理される) — 文言はプロキシ側 (line-proxy.ts) と共有の単一定義。
 */
export function isLineMonthlyLimit429(err: unknown): boolean {
  return (
    err instanceof LineApiError &&
    err.status === 429 &&
    err.responseBody.includes(LINE_MONTHLY_LIMIT_MESSAGE)
  );
}

export interface PlanQuotaSnapshot {
  limit: number;
  consumption: number;
  remaining: number;
}

/**
 * quota / consumption スナップショットの per-isolate TTL キャッシュ。
 * プロキシの一斉送信ガードは multicast の 500人チャンクごとに呼ばれるため、
 * 素通しだと 1 キャンペーンで数十回 quota API を叩く。consumption API は
 * そもそも反映が遅延する (LINE 側仕様) ので、30秒の鮮度低下は判定品質を
 * 変えない。isolate ローカルなので厳密な単一キャッシュではないが、
 * ホットパスの連続チャンクは同一 isolate で処理されるため実効性がある。
 */
const QUOTA_SNAPSHOT_TTL_MS = 30_000;
const QUOTA_SNAPSHOT_CACHE_MAX = 200;
const quotaSnapshotCache = new Map<
  string,
  { expires: number; value: PlanQuotaSnapshot | null }
>();

/**
 * LINE プランの limit / consumption / remaining を読む共通ヘルパー。
 * 上限なしプラン (type !== 'limited') は null。API エラーは throw する —
 * fail-open にするか合成 shortfall にするかは呼び出し元の責務
 * (送信前ガードは fail-open、429 事後通知は limit=0 の合成 shortfall)。
 *
 * cacheKey (通常はチャネルトークン) を渡すと TTL キャッシュが効く。
 * 省略時は毎回 API を読む (テスト・鮮度必須の呼び出し用)。
 */
export async function readPlanQuotaSnapshot(
  client: PlanQuotaClient,
  cacheKey?: string,
): Promise<PlanQuotaSnapshot | null> {
  if (cacheKey) {
    const cached = quotaSnapshotCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
  }

  const [quota, consumption] = await Promise.all([
    client.getMessageQuota(),
    client.getMessageQuotaConsumption(),
  ]);
  const value =
    quota.type !== 'limited' || typeof quota.value !== 'number'
      ? null
      : {
          limit: quota.value,
          consumption: consumption.totalUsage,
          remaining: Math.max(0, quota.value - consumption.totalUsage),
        };
  if (cacheKey) {
    if (quotaSnapshotCache.size >= QUOTA_SNAPSHOT_CACHE_MAX) quotaSnapshotCache.clear();
    quotaSnapshotCache.set(cacheKey, { expires: Date.now() + QUOTA_SNAPSHOT_TTL_MS, value });
  }
  return value;
}

/**
 * LINE プランの残りクォータが audience 人への一括送信に足りない場合に不足情報を
 * 返す。足りている・上限なしプラン・API エラー (トークン失効等) は null。
 *
 * audience は関数でも渡せる (lazy)。上限なしプランでは評価されないので、
 * COUNT クエリを「上限ありプランで残量比較が必要になったとき」だけに遅延できる。
 *
 * fail-open: クォータ確認自体の失敗で送信を止めてはいけない (確認 API の一時
 * 障害が全配信停止に化ける)。ブロックするのは「不足が確定した」ときだけ。
 * ただし remaining === 0 は quota API だけで不足が確定するため、audience の
 * COUNT が失敗しても fail-open せずブロックする (audience は表示用に 0 で埋める)。
 */
export async function getLinePlanQuotaShortfall(
  client: PlanQuotaClient,
  audience: number | (() => Promise<number>),
  cacheKey?: string,
): Promise<PlanQuotaShortfall | null> {
  let snapshot: PlanQuotaSnapshot | null;
  try {
    snapshot = await readPlanQuotaSnapshot(client, cacheKey);
  } catch (err) {
    console.error('LINE plan quota check failed (fail-open):', err);
    return null;
  }
  if (!snapshot) return null;

  // remaining === 0 は audience に依らず不足が確定 (何も送れない)。audience の
  // COUNT はここでは表示用でしかないので、その失敗で確定ブロックを取り消さない。
  if (snapshot.remaining === 0) {
    let audienceCount = 0;
    try {
      audienceCount = typeof audience === 'function' ? await audience() : audience;
    } catch (err) {
      console.error('quota shortfall audience count failed (blocking anyway):', err);
    }
    return { ...snapshot, audience: audienceCount };
  }

  try {
    const audienceCount = typeof audience === 'function' ? await audience() : audience;
    if (audienceCount > 0 && snapshot.remaining < audienceCount) {
      return { ...snapshot, audience: audienceCount };
    }
    return null;
  } catch (err) {
    console.error('LINE plan quota audience count failed (fail-open):', err);
    return null;
  }
}

/**
 * 「全員配信1回分」の需要 = 配信可能友だち数。
 * legacy な line_account_id NULL 行の扱いが要点:
 *   - 単一アカウント運用では NULL 行こそが友だちの本体 (migration 008 以前の行)
 *     なので含める。
 *   - マルチアカウント運用で全アカウントに NULL 行を加算すると、共有 NULL プール
 *     の分だけ全アカウントの需要が同時に水増しされ、小プランのアカウントが恒常的に
 *     誤 warning / 誤ブロックになる (over-count は「送らせない」方向に働くため、
 *     ブロック用途では危険側)。→ includeLegacyNullRows=false で厳密一致にする。
 */
export async function countDeliverableAudience(
  db: D1Database,
  lineAccountId: string | null,
  includeLegacyNullRows: boolean,
): Promise<number> {
  let where = 'is_following = 1';
  const binds: unknown[] = [];
  if (lineAccountId) {
    where += includeLegacyNullRows
      ? ' AND (line_account_id = ? OR line_account_id IS NULL)'
      : ' AND line_account_id = ?';
    binds.push(lineAccountId);
  }
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM friends WHERE ${where}`)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** アクティブな LINE アカウントが1つ以下の運用か (NULL 行加算の可否判定に使う)。 */
export async function isSingleAccountInstall(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM line_accounts WHERE is_active = 1`)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= 1;
}

/**
 * 'all' 送信のガード用 audience (lazy)。total_count 記録用のフォロワー数
 * (legacy NULL 行込みの多め見積もり) と違い、ブロック判定は「送らせない」方向に
 * 働くため、マルチアカウント運用では NULL 行を除いた厳密一致で数える — 共有
 * NULL プールの水増しで実際は送れる配信を誤ブロックしないため。
 * worker 内部の一斉配信 (broadcast.ts) と LINE API プロキシ (line-proxy.ts) が
 * 共有する単一定義 — NULL 行ポリシーが二箇所で乖離しないように。
 * knownSingleInstall: 呼び出し元がアクティブアカウント数を既に知っている場合に
 * 渡すと isSingleAccountInstall の COUNT クエリを省ける。
 */
export function allTargetGuardAudience(
  db: D1Database,
  accountId: string | null,
  knownSingleInstall?: boolean,
): () => Promise<number> {
  return async () => {
    if (!accountId) return countDeliverableAudience(db, null, true);
    const single = knownSingleInstall ?? (await isSingleAccountInstall(db));
    return countDeliverableAudience(db, accountId, single);
  };
}

export interface QuotaAlertInput {
  lineAccountId: string;
  accountName?: string | null;
  shortfall: PlanQuotaShortfall;
  /**
   * 検知元:
   *   - health-check: cron 監視 (ban-monitor.ts)
   *   - pre-send: worker 内部の一斉配信の送信前ガード (配信を中止した)
   *   - upstream-429: worker 内部の一斉配信をガード通過後に LINE がクォータ超過 429 で拒否した
   *     (ガードの fail-open / audience 過小見積もりを LINE 側が最終的に止めたケース)
   *   - proxy-pre-send: LINE API プロキシが外部クライアントの一斉送信を送信前に拒否した
   *   - proxy-upstream-429: プロキシ転送した一斉送信を LINE がクォータ超過 429 で拒否した
   */
  source: 'health-check' | 'pre-send' | 'upstream-429' | 'proxy-pre-send' | 'proxy-upstream-429';
  broadcastId?: string;
  broadcastTitle?: string;
}

/** created_at と同形式 (jstNow) で hours 時間前を返す。 */
function jstHoursAgo(hours: number): string {
  return toJstString(new Date(Date.now() - hours * 3600_000));
}

/** proxy-* 通知の時間 dedup 幅。 */
const PROXY_ALERT_DEDUP_HOURS = 1;

/**
 * source ごとの dedup ポリシー (null = dedup なし)。sourcePrefix を持つ source は
 * 同種 (metadata.source が prefix 一致) の既通知だけを重複と見なす — proxy 由来の
 * 「実際に送信が失敗した/中止した」通知が、直前の cron 警告 (health-check) に
 * 握りつぶされないように。health-check 側は source 無差別のまま: どの経路であれ
 * 同月に通知済みなら月次の再警告は不要。
 * Record にしているのは網羅性のため — source を追加するとここも型エラーで
 * 気づける (暗黙のフォールバックに落ちない)。
 */
const QUOTA_ALERT_DEDUP: Record<
  QuotaAlertInput['source'],
  { since: () => string; sourcePrefix?: string } | null
> = {
  'health-check': { since: () => monthStartJst() },
  'pre-send': null, // 配信中止は毎回通知 (冒頭コメント参照)
  'upstream-429': null, // 429 で draft へ戻った配信は自動リトライされない — pre-send と同じ理由
  'proxy-pre-send': { since: () => jstHoursAgo(PROXY_ALERT_DEDUP_HOURS), sourcePrefix: 'proxy-' },
  'proxy-upstream-429': { since: () => jstHoursAgo(PROXY_ALERT_DEDUP_HOURS), sourcePrefix: 'proxy-' },
};

/** source ごとの通知タイトル (網羅 Record — dedup と同じ理由)。 */
const QUOTA_ALERT_TITLES: Record<QuotaAlertInput['source'], (name: string) => string> = {
  'health-check': (name) => `LINEプラン月間クォータ不足: ${name}`,
  'pre-send': (name) => `一斉配信を中止: LINEプランクォータ不足 (${name})`,
  'upstream-429': (name) => `一斉配信がLINEクォータ超過で失敗 (${name})`,
  'proxy-pre-send': (name) => `プロキシ経由の一斉送信を中止: LINEプランクォータ不足 (${name})`,
  'proxy-upstream-429': (name) => `プロキシ経由の一斉送信がLINEクォータ超過で失敗 (${name})`,
};

/**
 * クォータ不足をオペレーターに通知する。通知したら true。
 * dedup は source ごと (QUOTA_ALERT_DEDUP 参照): health-check は月次、proxy-* は
 * 同種通知に対して1時間、pre-send は毎回通知。dedup は check-then-insert で
 * 非アトミック — 完全並行のバーストは複数通知し得るが、以後1時間は抑制される
 * ので best-effort で足りる。
 * best-effort: 通知の失敗が呼び出し元 (ヘルスチェック / 送信処理) を壊さない
 * よう、例外はすべて握りつぶす。
 */
export async function notifyQuotaAlert(
  db: D1Database,
  input: QuotaAlertInput,
): Promise<boolean> {
  try {
    const dedup = QUOTA_ALERT_DEDUP[input.source];
    if (dedup) {
      const already = await hasNotificationSince(db, {
        eventType: QUOTA_ALERT_EVENT,
        lineAccountId: input.lineAccountId,
        since: dedup.since(),
        sourcePrefix: dedup.sourcePrefix,
      });
      if (already) return false;
    }

    const { shortfall } = input;
    const name = input.accountName || input.lineAccountId;
    const title = QUOTA_ALERT_TITLES[input.source](name);
    // limit=0 は「不足の事実だけ分かって残量詳細が取れなかった」合成 shortfall
    // (LINE が 429 を返した後に quota API まで失敗したケース)。0通/0通 という
    // 誤解を招く数字を出さず、事実だけ伝える。
    // audience=0 は「対象人数は算出していない/できなかった」印 (upstream-429 の
    // 事後通知等)。0人と偽らず、人数の節ごと省く。
    const audienceClause =
      shortfall.audience > 0
        ? `配信対象 約${shortfall.audience}人に足りず、一括配信が失敗します。`
        : `一括配信が失敗します。`;
    const detail =
      shortfall.limit > 0
        ? `残り${shortfall.remaining}通 / 上限${shortfall.limit}通 (消費${shortfall.consumption}通)。` +
          audienceClause +
          `LINE Official Account Manager で追加メッセージ購入かプラン変更を検討してください。`
        : `LINEプランの月間クォータを超過しています (残量の詳細は取得できませんでした)。` +
          `LINE Official Account Manager で消費状況を確認し、追加メッセージ購入かプラン変更を検討してください。`;
    const body =
      input.broadcastTitle && input.source === 'pre-send'
        ? `一斉配信「${input.broadcastTitle}」を送信前に中止しました。${detail}`
        : input.broadcastTitle && input.source === 'upstream-429'
          ? `一斉配信「${input.broadcastTitle}」がLINEのクォータ超過 (429) で失敗し、下書きに戻しました。${detail}`
          : detail;
    const metadata = JSON.stringify({
      lineAccountId: input.lineAccountId,
      source: input.source,
      ...shortfall,
      ...(input.broadcastId ? { broadcastId: input.broadcastId } : {}),
    });

    // 有効な quota_alert ルールのチャネルを集める (channel → 最初に要求した ruleId)。
    // ルールが1つも無くても dashboard 行は必ず残す (事故の教訓: どこにも出ないのが
    // 最悪)。
    const rules = (await getActiveNotificationRulesByEvent(db, QUOTA_ALERT_EVENT)).filter(
      (r) => !r.line_account_id || r.line_account_id === input.lineAccountId,
    );
    const byChannel = new Map<string, string | undefined>([['dashboard', undefined]]);
    for (const rule of rules) {
      let channels: unknown = [];
      try {
        channels = JSON.parse(rule.channels);
      } catch {
        channels = [];
      }
      if (!Array.isArray(channels)) continue;
      for (const channel of channels) {
        if (typeof channel === 'string' && !byChannel.has(channel)) {
          byChannel.set(channel, rule.id);
        }
      }
    }

    // webhook チャネルの実配信は outgoing_webhooks の購読 (event_types) に依存する。
    // outgoing webhook は notification_rules と独立した購読系で、quota_alert (または
    // '*') を購読している外部 Webhook があれば常に発火する。実際に配信してから
    // 結果を記録する — 「購読者が居る」だけで sent と書くと、エンドポイントが
    // 落ちていても配信済みに見える (「通知したつもり」の再演)。
    const webhookSubscribers = await getActiveOutgoingWebhooksByEvent(db, QUOTA_ALERT_EVENT);
    let webhookDelivered = 0;
    if (webhookSubscribers.length > 0) {
      webhookDelivered = await fireOutgoingWebhooks(
        db,
        QUOTA_ALERT_EVENT,
        {
          eventData: {
            lineAccountId: input.lineAccountId,
            accountName: input.accountName ?? null,
            source: input.source,
            title,
            body,
            ...shortfall,
            ...(input.broadcastId ? { broadcastId: input.broadcastId } : {}),
          },
        },
        webhookSubscribers,
      );
    }

    for (const [channel, ruleId] of byChannel) {
      // dashboard は GET /api/notifications で読める記録なので記録時点で「配信済み」。
      // webhook は1件以上実際に届いたときだけ sent。email 等の未実装チャネルは
      // pending のまま残し、未配信を偽らない。
      const status =
        channel === 'dashboard'
          ? 'sent'
          : channel === 'webhook'
            ? webhookDelivered > 0 ? 'sent' : 'failed'
            : 'pending';
      await createNotification(db, {
        ruleId,
        eventType: QUOTA_ALERT_EVENT,
        title,
        body,
        channel,
        status,
        metadata,
        lineAccountId: input.lineAccountId,
      });
    }

    return true;
  } catch (err) {
    console.error(`notifyQuotaAlert failed (account ${input.lineAccountId}):`, err);
    return false;
  }
}
