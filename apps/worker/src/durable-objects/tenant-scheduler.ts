/**
 * テナント Worker の定期ジョブ (配信・リマインド・insight 取得など) を
 * 自走させる Durable Object。
 *
 * これまでは Cron Trigger (wrangler.toml [triggers]) が唯一の起動源だったが、
 * Cron Trigger の設定はプラットフォーム側の管理下にあり、環境によっては
 * トリガーが一度も発火しないまま放置され得る — しかも失敗ではなくただ
 * 「何も起きない」ため、気づくのがほぼ不可能という壊れ方をする。
 *
 * DO alarm はオブジェクト自身が持つ状態なので、この問題を構造的に避けられる:
 * alarm をセットしたら、それがどこで動いていようと自分自身で発火する。
 * さらに alarm ハンドラは「次の alarm を仕事より先にセットする」ことで
 * 1 tick の失敗がチェーン全体を止めない自己修復スケジュールになる。
 *
 * ## バインディング名・クラス名 (この2つの命名は他システムから参照される)
 * - class_name: TenantScheduler (このクラス)
 * - binding name: TENANT_SCHEDULER (apps/worker/wrangler.toml、および
 *   テナントを自動プロビジョニングする scripts/lib/tenant-wrangler.ts の両方で
 *   同名にすること — 片方だけ変えると「デプロイは成功するが alarm は一生
 *   armed されない」という気づきにくい壊れ方をする)
 *
 * ## 二重発火の扱い
 * 自己ホスト環境は Cron Trigger を使い続けられる仕様なので、DO alarm と
 * Cron Trigger の両方が同じ分に発火し得る。ここでは新しい排他制御を足さず、
 * scheduled() が呼び出すジョブ本体 (services/broadcast.ts の
 * `UPDATE ... WHERE status = 'scheduled'` などの楽観ロック / claim パターン)
 * が既に「同時に2回呼ばれても安全」という前提で書かれていることに乗る。
 * 現行の Cron Trigger 構成 (分足と6時間足の2本) 自体が、6時間境界の
 * 分では scheduled() を2回呼ぶ (トリガーごとに1回) ため、二重発火への耐性は
 * 今日のコードに既に要求されており実績もある。DO を足しても保証すべき
 * 前提の性質は変わらない。
 */
import { DurableObject } from 'cloudflare:workers';
import { scheduled } from '../scheduled.js';
import type { Env } from '../index.js';

/** 分足 cron ("* * * * *") と同じ粒度で自分自身を再アームする間隔。 */
export const SCHEDULER_TICK_INTERVAL_MS = 60_000;

/**
 * 次の分境界 (UTC 分の頭) にアラインしたアラーム時刻。`now + 60s` で再アーム
 * すると alarm 発火レイテンシぶんずつ tick が毎回前方へドリフトし、繰り上がりが
 * 分0をまたいだ時間帯は isHourlyTick (毎時クォータチェック) 等の「特定の分」判定が
 * silent にスキップされる。分境界に張り直せばドリフトは毎 tick リセットされる。
 */
export function nextMinuteBoundary(nowMs: number): number {
  return (Math.floor(nowMs / SCHEDULER_TICK_INTERVAL_MS) + 1) * SCHEDULER_TICK_INTERVAL_MS;
}

/** DO インスタンスは1テナントにつき1つで足りるので固定名で解決する。 */
export const SCHEDULER_INSTANCE_NAME = 'scheduler';

/**
 * 6時間足 cron (0時起点で6時間おき) の境界判定。UTC 0時起点で6時間ごと、分は0。
 * Cloudflare の Cron Trigger が実際にこの文字列にマッチする分だけ scheduled()
 * をもう一度呼ぶのと同じタイミングを再現する。
 */
export function isSixHourBoundary(now: Date): boolean {
  return now.getUTCMinutes() === 0 && now.getUTCHours() % 6 === 0;
}

/**
 * DurableObjectStorage のうち、このスケジューラが実際に使う部分だけを
 * 切り出したインターフェース。DO ランタイムなしでもテストできるように、
 * alarm ハンドラ本体はこの最小インターフェースだけに依存させている。
 */
export interface AlarmStorage {
  getAlarm(): Promise<number | null>;
  setAlarm(time: number | Date): Promise<void>;
}

/** scheduled() に渡す最小限のイベント形。cron と scheduledTime しか読まれない。 */
export interface SchedulerTickEvent {
  cron: string;
  scheduledTime: number;
}

export type RunSchedulerJobs = (event: SchedulerTickEvent) => Promise<void>;

/**
 * DO の alarm ハンドラ本体。
 *
 * 最重要の順序: 次のアラームを "先に" セットしてから仕事をする。
 * 仕事 (runJobs) が例外を投げても、次 tick のアラームは既にセット済みなので
 * チェーンは死なない — 失われるのはこの1 tick 分の仕事だけになる。逆順に
 * すると、仕事が失敗した瞬間に次のアラームが二度とセットされず、以後
 * 誰かが気づいて手動で叩き直すまで配信・リマインドが永久に止まる。
 *
 * runJobs の例外はここで握りつぶす (再 throw しない)。DO ランタイムは
 * alarm ハンドラが例外を投げると自動リトライする仕組みを持っており、
 * 再 throw するとその自動リトライ分のアラームと、上で明示的にセットした
 * 次アラームの分とで二重に発火し得る。自前でスケジュールを持つ以上、
 * ランタイム側の自動リトライには任せない。
 */
export async function runSchedulerTick(
  storage: AlarmStorage,
  runJobs: RunSchedulerJobs,
  now: Date = new Date(),
): Promise<void> {
  // 1. 再アーム最優先。work の成否を待たない。分境界アライン (nextMinuteBoundary
  //    のコメント参照) — ドリフトで毎時 tick が飛ばないように。
  await storage.setAlarm(nextMinuteBoundary(now.getTime()));

  // 2. 実ジョブ。cron trigger が発火したときと同じ event 形を渡し、
  //    scheduled() 内の event.cron 分岐 (mileage キュー / 6h ジョブ) を
  //    そのまま再利用する。
  try {
    await runJobs({ cron: '* * * * *', scheduledTime: now.getTime() });

    // Cloudflare Cron Triggers は "* * * * *" と "0 */6 * * *" が同時に
    // マッチする分では scheduled() を2回呼ぶ (トリガーごとに1回)。DO でも
    // 同じ回数だけ呼び、6h ジョブ側の event.cron 分岐を正しく踏ませる。
    if (isSixHourBoundary(now)) {
      await runJobs({ cron: '0 */6 * * *', scheduledTime: now.getTime() });
    }
  } catch (err) {
    console.error('[TenantScheduler] tick failed (next alarm already armed):', err);
  }
}

/**
 * alarm が外れていたら再アームする。webhook 受信のたびに呼ばれる想定なので
 * 軽量に保つ — getAlarm() 1回で、外れているときだけ setAlarm() を足す。
 * 戻り値は「今回アームし直したか」で、テストで観測しやすくするためのもの。
 */
export async function ensureAlarmArmed(
  storage: AlarmStorage,
  now: Date = new Date(),
): Promise<boolean> {
  const existing = await storage.getAlarm();
  if (existing !== null) return false;
  await storage.setAlarm(nextMinuteBoundary(now.getTime()));
  return true;
}

export class TenantScheduler extends DurableObject<Env['Bindings']> {
  constructor(ctx: DurableObjectState, env: Env['Bindings']) {
    super(ctx, env);
    // このオブジェクトへの最初のアクセス (どの経路であれ) で必ず一度は
    // armed 状態にする。blockConcurrencyWhile 中は他のリクエストが待たされる
    // ので、以後の alarm()/ensureArmed() 呼び出しと競合しない。
    // コンストラクタは async にできないので、失敗時は自前で catch して
    // unhandled rejection にしない (blockConcurrencyWhile 自体の
    // 「失敗時は DO をリセットする」という挙動はコールバック内の reject で
    // 別途トリガーされる — ここでの catch はそれを妨げない)。
    ctx.blockConcurrencyWhile(async () => {
      await ensureAlarmArmed(ctx.storage);
    }).catch((err) => {
      console.error('[TenantScheduler] initial arm-on-construct failed:', err);
    });
  }

  async alarm(): Promise<void> {
    await runSchedulerTick(this.ctx.storage, (event) =>
      // scheduled() は ScheduledEvent (Event のサブクラス) を受け取る型だが、
      // 実際に読むのは .cron と .scheduledTime の2フィールドだけなので、
      // DO 経由で合成したイベントをそのまま渡している。ctx (DurableObjectState)
      // も ExecutionContext ではないが waitUntil を持つ同じ形なので同様に渡す。
      scheduled(
        event as unknown as ScheduledEvent,
        this.env,
        this.ctx as unknown as ExecutionContext,
      ));
  }

  /** webhook など受信経路から叩かれる自己修復フック。毎リクエストで呼んでよい。 */
  async ensureArmed(): Promise<void> {
    await ensureAlarmArmed(this.ctx.storage);
  }
}

/**
 * webhook などの受信経路から安く叩ける自己修復エントリポイント。
 * TENANT_SCHEDULER バインディングが無い環境 (テストや移行途中など) でも
 * webhook 応答を止めないよう、内部で完結して例外を投げない。
 */
export async function ensureSchedulerArmed(env: {
  TENANT_SCHEDULER?: DurableObjectNamespace<TenantScheduler>;
}): Promise<void> {
  try {
    const ns = env.TENANT_SCHEDULER;
    if (!ns) return;
    const stub = ns.get(ns.idFromName(SCHEDULER_INSTANCE_NAME));
    await stub.ensureArmed();
  } catch (err) {
    // 自己修復チェックの失敗で webhook 応答を止めない。次のリクエストで
    // また同じチェックが走るので、一時的な失敗は自然にリトライされる。
    console.error('[TenantScheduler] self-heal check failed:', err);
  }
}
