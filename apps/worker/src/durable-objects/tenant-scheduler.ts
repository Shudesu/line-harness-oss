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
 * ## 実行担当 (一本化)
 * 以前は Cron Trigger と DO alarm の両方が毎分 scheduled() を呼んでおり
 * (排他なし)、予約配信チェック・シナリオ配信・ウェビナー追客などの
 * D1 読み取りが毎分2回ずつ発生していた。ジョブ本体の楽観ロック / claim で
 * 重複送信は防がれていたが、読み取り量は2倍になる。
 *
 * いまは「Cron が動いている間は Cron が唯一の実行者、DO alarm は Cron が
 * 止まったときだけ代行する」:
 * - Cron は scheduledFromCron() で、ジョブの前に DO へ「Cron が来た」ことを
 *   記録 (noteCronTick) してから scheduled() を実行する。Cron の発火時刻
 *   (分足・6時間足・毎時・5分ごと) の判定は従来とまったく同じ。
 * - DO alarm は毎分再アームを続け、直近 CRON_LIVENESS_WINDOW_MS 以内に分足系
 *   Cron の記録があれば毎分ジョブを実行しない。6時間保守も同様に6時間足 Cron の
 *   記録で別々に判定する (5分足1本だけの構成でも6時間保守は alarm が担う)。
 *   記録が途絶えたら (Cron が発火しない環境) 従来どおり alarm が実行する。
 * - バインディングが無い環境は Cron だけで従来どおり動く。
 * 切り替わりの境目の1分だけ両方が走ることはあり得るが、これは従来の常時二重
 * 起動と同じ性質で、ジョブ本体はそれに耐える。
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

/**
 * Cron がこの時間内に来ていれば、alarm はジョブを実行しない。分足 Cron の
 * 間隔 (60秒) に発火の揺らぎを足しても十分に収まり、Cron が2回続けて
 * 来なければ alarm が代行を始める長さ。
 */
export const CRON_LIVENESS_WINDOW_MS = 150_000;

/**
 * 6時間足 Cron がこの時間内に来ていれば、alarm は6時間保守を実行しない。
 * 前回の6時間足 (6時間前) が見えていれば今回も Cron が来る前提に立つ。
 * 6時間足 Cron を持たない構成 (例: 5分足1本だけ) では記録が無いので、
 * alarm が従来どおり6時間保守を担当する。
 */
export const SIX_HOUR_CRON_LIVENESS_WINDOW_MS = 6 * 60 * 60_000 + 10 * 60_000;

/** DO storage 上で「最後に分足系 Cron が来た時刻 (epoch ms)」を持つキー。 */
export const LAST_CRON_TICK_KEY = 'lastCronTickAt';
/** DO storage 上で「最後に6時間足 Cron が来た時刻 (epoch ms)」を持つキー。 */
export const LAST_SIX_HOUR_CRON_TICK_KEY = 'lastSixHourCronTickAt';
/** DO storage 上で「6時間保守を実行済みの最新スロット番号」を持つキー。 */
export const SIX_HOUR_SLOT_DONE_KEY = 'sixHourSlotDone';

export const SIX_HOUR_MS = 6 * 60 * 60_000;
/**
 * 6時間境界の alarm が遅れた・境界時点では Cron が生きて見えたのに来なかった、
 * などでそのスロットの保守が未実行なら、境界からこの時間を過ぎた最初の tick で
 * 取り戻す。6時間足 Cron がまだ生きていれば Cron に任せる。
 */
export const SIX_HOUR_CATCH_UP_GRACE_MS = 10 * 60_000;

/** epoch ms が属する6時間スロットの番号 (UTC 0/6/12/18 時起点)。 */
export function sixHourSlot(ms: number): number {
  return Math.floor(ms / SIX_HOUR_MS);
}

const SIX_HOUR_CRON = '0 */6 * * *';

/** Cron の種類ごとの最終到来時刻。 */
export interface CronLiveness {
  minute?: number | null;
  sixHour?: number | null;
  /** 6時間保守を実行済みの最新スロット番号 (Cron / alarm のどちらで実行したかは問わない)。 */
  sixHourSlotDone?: number | null;
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
  cronLiveness: () => Promise<CronLiveness> = async () => ({}),
  markSixHourSlotDone: (slot: number) => Promise<void> = async () => {},
): Promise<void> {
  // 1. 再アーム最優先。work の成否を待たない。分境界アライン (nextMinuteBoundary
  //    のコメント参照) — ドリフトで毎時 tick が飛ばないように。
  await storage.setAlarm(nextMinuteBoundary(now.getTime()));

  // Cron が生きている間は Cron が唯一の実行者 (冒頭「実行担当」参照)。
  // 分足系と6時間足は別々に判定する (片方の Cron しか無い構成があるため)。
  // 記録が読めないときは安全側 (ジョブを止めない) に倒す。
  let liveness: CronLiveness = {};
  try {
    liveness = await cronLiveness();
  } catch (err) {
    console.error('[TenantScheduler] cron liveness check failed; running jobs:', err);
  }
  const nowMs = now.getTime();
  const runMinute = !isCronLive(liveness.minute, nowMs);
  const slot = sixHourSlot(nowMs);
  if (liveness.sixHourSlotDone == null && !isSixHourBoundary(now)) {
    // 記録が無い (この変更の導入直後・新しい DO) ときは、従来どおり次の境界から
    // 数え始める。途中のスロットで保守を余分に走らせない。
    try {
      await markSixHourSlotDone(slot);
    } catch (err) {
      console.error('[TenantScheduler] failed to record six-hour slot:', err);
    }
    liveness = { ...liveness, sixHourSlotDone: slot };
  }
  const sixHourCronLive = isCronLive(liveness.sixHour, nowMs, SIX_HOUR_CRON_LIVENESS_WINDOW_MS);
  const slotPending = liveness.sixHourSlotDone !== slot;
  const runSixHour = slotPending && !sixHourCronLive && (
    isSixHourBoundary(now)
    // 境界の tick を逃した (alarm 遅延・Cron が途中で止まった等) ときの取り戻し
    || nowMs - slot * SIX_HOUR_MS >= SIX_HOUR_CATCH_UP_GRACE_MS
  );
  if (runSixHour) {
    // Cron と同じく1スロット1回。失敗しても毎分やり直さない (次のスロットで再実行)。
    try {
      await markSixHourSlotDone(slot);
    } catch (err) {
      console.error('[TenantScheduler] failed to record six-hour slot:', err);
    }
  }

  // 2. 実ジョブ。cron trigger が発火したときと同じ event 形を渡し、
  //    scheduled() 内の event.cron 分岐 (mileage キュー / 6h ジョブ) を
  //    そのまま再利用する。Cloudflare Cron Triggers は "* * * * *" と
  //    "0 */6 * * *" が同時にマッチする分では scheduled() を2回呼ぶ
  //    (トリガーごとに1回) ので、DO でも同じ形で呼ぶ。片方の失敗で
  //    もう片方を飛ばさない。
  const events: SchedulerTickEvent[] = [];
  if (runMinute) events.push({ cron: '* * * * *', scheduledTime: nowMs });
  if (runSixHour) events.push({ cron: SIX_HOUR_CRON, scheduledTime: nowMs });
  for (const event of events) {
    try {
      await runJobs(event);
    } catch (err) {
      console.error('[TenantScheduler] tick failed (next alarm already armed):', err);
    }
  }
}

/** 直近 windowMs 以内に Cron が来ていれば true。 */
export function isCronLive(
  lastCronTickAt: number | null | undefined,
  nowMs: number,
  windowMs: number = CRON_LIVENESS_WINDOW_MS,
): boolean {
  return typeof lastCronTickAt === 'number'
    && nowMs - lastCronTickAt >= 0
    && nowMs - lastCronTickAt < windowMs;
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
      ),
      new Date(),
      async () => ({
        minute: await this.ctx.storage.get<number>(LAST_CRON_TICK_KEY),
        sixHour: await this.ctx.storage.get<number>(LAST_SIX_HOUR_CRON_TICK_KEY),
        sixHourSlotDone: await this.ctx.storage.get<number>(SIX_HOUR_SLOT_DONE_KEY),
      }),
      (slot) => this.ctx.storage.put(SIX_HOUR_SLOT_DONE_KEY, slot),
    );
  }

  /**
   * Cron から毎回呼ばれる。「Cron が来た」ことを記録し、alarm も自己修復する。
   * 記録がある間、alarm はジョブを実行しない (冒頭「実行担当」参照)。
   */
  async noteCronTick(atMs: number = Date.now(), cron: string = '* * * * *'): Promise<void> {
    if (cron === SIX_HOUR_CRON) {
      // Cron がこのスロットの6時間保守を実行するので、alarm は取り戻さない。
      await this.ctx.storage.put({ [LAST_SIX_HOUR_CRON_TICK_KEY]: atMs, [SIX_HOUR_SLOT_DONE_KEY]: sixHourSlot(atMs) });
    } else {
      await this.ctx.storage.put(LAST_CRON_TICK_KEY, atMs);
    }
    await ensureAlarmArmed(this.ctx.storage);
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

/**
 * Cron Trigger の入口 (index.ts の default export.scheduled)。
 *
 * Cron は常に scheduled() を実行する (発火時刻ごとの判定は従来どおり)。
 * TENANT_SCHEDULER がある環境では、その前に DO へ Cron の到来を記録し、
 * 同じ分に DO alarm がジョブを重ねて実行しないようにする。記録に失敗しても
 * ジョブは止めない (Cron が実行者。最悪でも従来と同じ二重起動になるだけ)。
 */
export async function scheduledFromCron(
  event: ScheduledEvent,
  env: Env['Bindings'],
  ctx: ExecutionContext,
): Promise<void> {
  const ns = (env as { TENANT_SCHEDULER?: DurableObjectNamespace<TenantScheduler> }).TENANT_SCHEDULER;
  if (ns) {
    try {
      await ns.get(ns.idFromName(SCHEDULER_INSTANCE_NAME)).noteCronTick(Date.now(), event.cron);
    } catch (err) {
      console.error('[TenantScheduler] failed to record cron tick (jobs still run from cron):', err);
    }
  }
  await scheduled(event, env, ctx);
}
