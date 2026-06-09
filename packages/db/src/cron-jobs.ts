// migration 072_cron_jobs (2026-06-07) のヘルパー。
//
// 設計意図:
//   旧 scheduled() 内の 6h ジョブ群 (booking-expirer / event-booking-expirer /
//   fingerprint-purger) は `if (event.cron === '0 */6 * * *')` 文字列ガードで
//   起動判定していたが、067_cron_locks の単一 slot mutex と組み合わさると
//   "*/5 * * * *" 側 isolate が claim 勝ちした場合に 6h ジョブが永久 skip
//   される競合があった (Cloudflare スケジューラの fire 順序は非決定的)。
//
//   対策: ジョブごとに最終実行時刻を `cron_jobs` テーブルに記録し、毎 tick で
//   「最後の成功から 6 時間以上経ったか?」で判定する。5min cron が claim 勝ち
//   しても、6h 以上眠れば次の 5min tick で確実に救済される (= 067_cron_locks
//   との二重防御)。
//
//   `last_run_duration_ms` / `last_success` は health-check 用に開けてある観測カラム。
//   現状の caller は失敗時の rollback はしない (失敗しても markCronJobRan で
//   last_run_at は前進する設計)。これは「失敗ジョブが無限再試行で 5min ごとに
//   走り続けて 1k subrequest 予算を食い潰す」事故を避けるための fail-forward。
//   永続的に壊れているジョブは last_success=0 が連続するので health-check 側で検知する。

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

interface CronJobRow {
  last_run_at: string;
}

/**
 * 指定ジョブを「最終成功から 6 時間以上経過しているか」で判定する。
 * 初回 (行が無い) は常に true を返す = 必ず 1 回は走らせる。
 *
 * 例: shouldRunSixHourJob(env.DB, 'booking-expirer')
 */
export async function shouldRunSixHourJob(
  db: D1Database,
  jobName: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT last_run_at FROM cron_jobs WHERE job_name = ?`)
    .bind(jobName)
    .first<CronJobRow>();
  if (!row) return true;
  const lastRunMs = Date.parse(row.last_run_at);
  if (!Number.isFinite(lastRunMs)) return true; // 壊れた値は再実行で復旧
  return Date.now() - lastRunMs >= SIX_HOURS_MS;
}

/**
 * ジョブ完了時に呼ぶ。成功/失敗どちらでも last_run_at は前進させる (fail-forward)。
 *
 * 例: markCronJobRan(env.DB, 'booking-expirer', 1234)
 */
export async function markCronJobRan(
  db: D1Database,
  jobName: string,
  durationMs?: number,
  success = true,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cron_jobs (job_name, last_run_at, last_run_duration_ms, last_success)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(job_name) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         last_run_duration_ms = excluded.last_run_duration_ms,
         last_success = excluded.last_success`,
    )
    .bind(
      jobName,
      new Date().toISOString(),
      durationMs ?? null,
      success ? 1 : 0,
    )
    .run();
}
