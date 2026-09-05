import { LineClient } from '@line-crm/line-sdk';
import {
  getLineAccounts,
  enqueueFollowingMileageMilestones,
  processPendingMileageEvents,
} from '@line-crm/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts, processQueuedBroadcasts } from './services/broadcast.js';
import { startBulkSendJobs } from './services/quota.js';
import { processReminderDeliveries } from './services/reminder-delivery.js';
import { checkAccountHealth } from './services/ban-monitor.js';
import { refreshLineAccessTokens } from './services/token-refresh.js';
import { processInsightFetch } from './services/insight-fetcher.js';
import { processDueReminders } from './services/booking-reminders.js';
import { runExpirer } from './services/booking-expirer.js';
import { processDueEventReminders } from './services/event-booking-reminders.js';
import { processDueMeetConsultationReminders } from './services/meet-consultation-reminders.js';
import { runEventBookingExpirer } from './services/event-booking-expirer.js';
import { logRetentionDays } from './services/log-retention.js';
import { sendEventBookingNotification } from './services/event-booking-notifier.js';
import { sendBookingNotification } from './services/booking-notifier.js';
import { DEFAULT_ACCOUNT_SETTINGS } from './services/booking-types.js';
import { lineProxy } from './routes/line-proxy.js';
import type { Env } from './index.js';

/**
 * 5分に1回だけ通すゲート。
 *
 * この関数を通る tick は3種類ある:
 *   - 分足 cron ("* * * * *")  … apps/worker/wrangler.toml の構成
 *   - DO alarm                 … tenant-scheduler.ts が分足と同じ cron 文字列を積む
 *   - 5分足 cron ("*\/5 * * * *") … インストーラ (packages/create-line-harness) と
 *     テナント生成 (scripts/lib/tenant-wrangler.ts) が書く構成
 * 前2つは毎分来るので分が5の倍数のときだけ通し、最後の1つは既に5分粒度なので
 * そのまま通す。分足だけを見ていると、5分足 cron しか持たない環境で中の
 * ジョブが一度も走らない。
 *
 * 6時間足 cron ("0 *\/6 * * *") は弾く。分が0なので、通してしまうと6時間境界の
 * 分だけ同じジョブが2回走る (Cloudflare はトリガーごとに scheduled() を呼ぶ)。
 */
export function isFiveMinuteTick(event: { cron: string; scheduledTime: number }): boolean {
  if (event.cron === '*/5 * * * *') return true;
  return event.cron === '* * * * *' && new Date(event.scheduledTime).getUTCMinutes() % 5 === 0;
}

/**
 * 毎時 (分=0) の tick か。月次粒度で十分な監視 (LINE プランクォータ) を分足・
 * 5分足の tick から間引くのに使う。isFiveMinuteTick と同じく 6時間足 cron は
 * 二重実行防止で弾く。
 */
export function isHourlyTick(event: { cron: string; scheduledTime: number }): boolean {
  if (event.cron === '0 */6 * * *') return false;
  return new Date(event.scheduledTime).getUTCMinutes() === 0;
}

// Scheduled handler — Cron Trigger と DO alarm (durable-objects/tenant-scheduler.ts)
// の双方から呼ばれる共通ジョブ本体。index.ts から切り出しているのは、
// tenant-scheduler.ts がこの関数を import する際に index.ts 自体との
// 循環 import を作らないため（index.ts は TenantScheduler を re-export する
// ので、逆方向の依存が既にある）。呼び出し元ごとの違いは event.cron に
// どの文字列を積むかだけで、ジョブ本体のロジックは一切変えていない。
//
// 全アカウント分をまとめて1回だけ実行する
export async function scheduled(
  event: ScheduledEvent,
  env: Env['Bindings'],
  ctx: ExecutionContext,
): Promise<void> {
  // Get all active accounts from DB
  const dbAccounts = await getLineAccounts(env.DB);

  // Build LineClient map for insight fetching (keyed by account id)
  const lineClients = new Map<string, LineClient>();
  for (const account of dbAccounts) {
    if (account.is_active) {
      lineClients.set(account.id, new LineClient(account.channel_access_token));
    }
  }
  const defaultLineClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);

  // 配信系は1回だけ実行（内部でfriendのline_account_idから正しいlineClientを動的解決）
  // 以前はアカウントごとにループしていたが、アカウントフィルタなしのDBクエリで
  // 全アカウントの配信が各ループで重複実行されていたバグを修正
  // Phase 1: 復旧処理 (batch_offset=-1 → 0 にする軽量な UPDATE のみ) を queue 処理より
  // 先に await 完了させる。これで stalled/stuck から復旧した配信が同じ cron tick の
  // processQueuedBroadcasts に拾われ、復旧レイテンシが 1 tick 縮む。recover は inline 送信を
  // 含まない高速処理なので、先に await しても他ジョブを starve させない。
  const { recoverStalledBroadcasts, recoverStuckDeliveries } = await import('@line-crm/db');
  await Promise.allSettled([
    recoverStalledBroadcasts(env.DB),
    recoverStuckDeliveries(env.DB),
  ]);

  // Booking / event-booking リマインドは時刻厳守 + 軽量 (数件/tick、上限100件) なので、
  // 重い配信・insight ジョブより先に実行する。以前は最後に置かれていたため、
  // 手前のジョブが invocation を止めると数時間分のリマインドが未送信のまま
  // starts_at を過ぎ、「開始後は送らない」ガードで永久 pending になる事故が
  // 発生した (2026-06-01 / 2026-06-15、計 10 件送り漏れ)。
  // token refresh はリマインドより先に済ませる (失効直後トークンでの 401 送信を防ぐ。
  // 旧順序では refresh が先だった invariant の維持)。
  try {
    await refreshLineAccessTokens(env.DB);
  } catch (e) {
    console.error('token refresh error:', e);
  }

  try {
    const result = await processDueReminders(env.DB, {
      now: new Date(),
      sender: sendBookingNotification,
      reminderHoursBefore: DEFAULT_ACCOUNT_SETTINGS.reminder_hours_before,
    });
    if (result.sent + result.failed > 0) {
      console.log(`[booking-reminders] sent=${result.sent} failed=${result.failed}`);
    }
  } catch (e) {
    console.error('booking-reminders error:', e);
  }

  try {
    const result = await processDueEventReminders(env.DB, {
      now: new Date(),
      sender: sendEventBookingNotification,
    });
    if (result.sent + result.failed > 0) {
      console.log(`[event-booking-reminders] sent=${result.sent} failed=${result.failed}`);
    }
  } catch (e) {
    console.error('event-booking-reminders error:', e);
  }

  // 外部Google Calendarで確定したMeet個別相談。前日・1時間前のLINE通知を
  // D1で管理し、送信は必ずL Harness Proxyを通す。
  try {
    const result = await processDueMeetConsultationReminders(env.DB, {
      now: new Date(),
      proxyBaseUrl:
        env.WORKER_PUBLIC_URL ?? 'https://your-worker.your-subdomain.workers.dev',
      proxyDispatch: (request) => Promise.resolve(lineProxy.fetch(request, env, ctx)),
    });
    if (result.sent + result.failed > 0) {
      console.log(`[meet-consultation-reminders] sent=${result.sent} failed=${result.failed}`);
    }
  } catch (e) {
    console.error('meet-consultation-reminders error:', e);
  }

  // ウェビナー予約リマインド (セッション選択メニュー)。時刻厳守・軽量なので
  // booking 系リマインドと同じく重いジョブより先に実行する。
  try {
    const { processWebinarReminders } = await import('./services/webinar-reminders.js');
    const liffMatch = /liff\.line\.me\/([^/?]+)/.exec(env.LIFF_URL ?? '');
    const result = await processWebinarReminders(
      env.DB,
      {
        proxyBaseUrl:
          env.WORKER_PUBLIC_URL ?? 'https://your-worker.your-subdomain.workers.dev',
        defaultAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
        defaultLiffId: liffMatch?.[1] ?? null,
        proxyDispatch: (request) => Promise.resolve(lineProxy.fetch(request, env, ctx)),
      },
    );
    if (result.sent + result.failed > 0) {
      console.log(`[webinar-reminders] sent=${result.sent} failed=${result.failed}`);
    }
  } catch (e) {
    console.error('webinar-reminders error:', e);
  }

  // 予約画面の未予約、予約後の未視聴、フォーム途中離脱、回答後の相談未予約を
  // 段階別に自動追客する。対象は followup config で有効化したウェビナーだけ。
  try {
    const { processWebinarFollowups } = await import('./services/webinar-followups.js');
    const liffMatch = /liff\.line\.me\/([^/?]+)/.exec(env.LIFF_URL ?? '');
    const result = await processWebinarFollowups(env.DB, {
      proxyBaseUrl:
        env.WORKER_PUBLIC_URL ?? 'https://your-worker.your-subdomain.workers.dev',
      defaultAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
      defaultLiffId: liffMatch?.[1] ?? null,
      proxyDispatch: (request) => Promise.resolve(lineProxy.fetch(request, env, ctx)),
    });
    if (result.sent + result.failed > 0) {
      console.log(`[webinar-followups] sent=${result.sent} failed=${result.failed}`);
    }
  } catch (e) {
    console.error('webinar-followups error:', e);
  }

  // Phase 2: 配信系と定期ジョブを並列実行する。processScheduledBroadcasts は tag/all の
  // inline 送信を含み時間がかかり得るため、queue 処理と並列にして互いを block しない
  // (barrier 化すると長い scheduled 送信が queue 処理を待たせる)。scheduled dedup は
  // status='sending', batch_offset=0 に enqueue され、同 tick もしくは次 tick (最大5分、
  // 5分 cron の粒度内) で processQueuedBroadcasts に拾われて分割送信される。
  //
  // 例外: 月間送信上限が設定されているときだけ、この配信3ジョブは
  // startBulkSendJobs が直列 (queued → scheduled → step) に切り替える。並列だと
  // 各ジョブが自分のスナップショットしか見ず合算で上限を超えられるため。
  // リマインダー等クォータ対象外のジョブは従来どおり常に並列。
  const jobs = [];
  jobs.push(...startBulkSendJobs(env, [
    () => processQueuedBroadcasts(env.DB, defaultLineClient, env.WORKER_URL, env),
    () => processScheduledBroadcasts(env.DB, defaultLineClient, env.WORKER_URL, env),
    () => processStepDeliveries(env.DB, defaultLineClient, env.WORKER_URL, env),
  ]));
  jobs.push(processReminderDeliveries(env.DB, defaultLineClient));

  // Mileage is an eventually-consistent projection. Reuse the existing
  // minute cron invocation, but drain only every five minutes and at most 100
  // actions per batch so it adds no extra Cron Trigger and keeps D1 load flat.
  //
  // アカウントのヘルスチェックも同じ tick に相乗りさせる。分足で回すと全アカウント
  // 分の LINE API (/v2/bot/info) を毎分叩くことになり (2026-08-26 実測: 43テナントで
  // 1日6.2万回)、そこまでの即時性は要らない — 403 の検知が最大5分遅れるだけ。
  if (isFiveMinuteTick(event)) {
    // クォータ残量は月次粒度の信号なので毎時 tick だけ確認する (checkQuota)。
    // 5分毎に全アカウント分の quota API を叩くと bot/info を分足→5分に
    // 落とした経緯 (上のコメント参照) と同じ過剰負荷になる。
    jobs.push(checkAccountHealth(env.DB, { checkQuota: isHourlyTick(event) }));
    jobs.push(
      processPendingMileageEvents(env.DB, { limit: 100 }).then((result) => {
        if (result.claimed > 0) {
          console.log(
            `[mileage-queue] processed=${result.processed} failed=${result.failed} granted=${result.granted}`,
          );
        }
      }),
    );
  }

  await Promise.allSettled(jobs);

  // Fetch broadcast insights (runs daily, self-throttled)
  try {
    await processInsightFetch(env.DB, lineClients, defaultLineClient);
  } catch (e) {
    console.error('Insight fetch error:', e);
  }

  // Booking expirer — runs only on the 6h cron tick.
  if (event.cron === '0 */6 * * *') {
    try {
      const result = await enqueueFollowingMileageMilestones(env.DB, {
        limitPerMilestone: 1000,
      });
      if (result.eventsCreated + result.queued > 0) {
        console.log(
          `[following-mileage] events=${result.eventsCreated} queued=${result.queued}`,
        );
      }
    } catch (e) {
      console.error('following-mileage error:', e);
    }

    try {
      const result = await runExpirer(env.DB, {
        now: new Date(),
        sender: sendBookingNotification,
      });
      console.log(
        `[booking-expirer] expired=${result.expired} idempotency_purged=${result.idempotencyPurged}`,
      );
    } catch (e) {
      console.error('booking-expirer error:', e);
    }
  }

  // Event-booking expirer — 6h cron tick.
  if (event.cron === '0 */6 * * *') {
    try {
      const result = await runEventBookingExpirer(env.DB, { now: new Date() });
      console.log(
        `[event-booking-expirer] expired=${result.expired} idempotency_purged=${result.idempotencyPurged}`,
      );
    } catch (e) {
      console.error('event-booking-expirer error:', e);
    }

    // Message-log retention (opt-in via LOG_RETENTION_DAYS; unset = keep forever).
    // Runs last: it only frees storage, so every delivery job outranks it.
    if (logRetentionDays(env) > 0) {
      try {
        const { runLogRetention } = await import('./services/log-retention.js');
        const res = await runLogRetention(env.DB, env.IMAGES, env);
        if (res.archived > 0) {
          console.log(
            `log-retention: archived ${res.archived} rows in ${res.batches} batch(es)`,
          );
        }
      } catch (err) {
        console.error('log-retention failed:', err);
      }
    }
  }

  // Cross-account duplicate detection — disabled.
  // The cron used to materialize duplicates into the tag system but the 1k-subrequest
  // budget can't drain a 1k+ candidate backlog, and a live SELECT against
  // friends.picture_url / display_name / status_message gives the same answer
  // on demand. Replacement: a /api/duplicates endpoint plus a dashboard view
  // (planned alongside the multi-provider UI work). Keeping the service file
  // (apps/worker/src/services/duplicate-detect.ts) and the existing
  // `重複:` tag rows untouched until that replacement lands.
}
