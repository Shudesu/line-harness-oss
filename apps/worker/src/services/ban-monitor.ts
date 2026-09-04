/**
 * BAN検知モニター — cronトリガーで定期実行
 *
 * LINE APIのエラー率を監視し、BAN リスクを検出する
 * 403/429 エラーのパターンを分析してリスクレベルを判定
 *
 * 2026-09-01 事故対応: LINE プラン月間クォータの残量チェックも同居させる。
 * 残量が配信可能友だち数を下回った時点で warning (残0なら danger) にし、
 * notifyQuotaAlert でオペレーターに通知する (ダッシュボードを開かなくても
 * 気づけるようにする — GET /api/line-accounts/delivery-health は受動的)。
 * クォータは月次粒度の信号なので、opts.checkQuota が true の tick (毎時 —
 * scheduled.ts 参照) だけ確認し、5分毎の bot/info チェックに API 呼び出しを
 * 上乗せしない (bot/info を分足→5分に落とした経緯と同じ配慮)。
 */

import {
  getLineAccounts,
  createAccountHealthLog,
  getAccountHealthLogs,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import {
  countDeliverableAudience,
  getLinePlanQuotaShortfall,
  notifyQuotaAlert,
} from './quota-alert.js';

export async function checkAccountHealth(
  db: D1Database,
  opts: { checkQuota?: boolean } = {},
): Promise<void> {
  const accounts = await getLineAccounts(db);
  const activeAccounts = accounts.filter((a) => a.is_active);
  // legacy な line_account_id NULL 行は単一アカウント運用でのみ audience に含める
  // (マルチアカウントで全アカウントに加算すると共有 NULL プール分が水増しされ、
  // 小プランのアカウントが恒常的に誤 warning になる)。
  const includeLegacyNullRows = activeAccounts.length <= 1;

  for (const account of activeAccounts) {
    try {
      await checkSingleAccount(db, account, {
        checkQuota: opts.checkQuota ?? false,
        includeLegacyNullRows,
      });
    } catch (err) {
      console.error(`ヘルスチェックエラー (account ${account.id}):`, err);
    }
  }
}

async function checkSingleAccount(
  db: D1Database,
  account: { id: string; name?: string | null; channel_access_token: string },
  quotaOpts: { checkQuota: boolean; includeLegacyNullRows: boolean },
): Promise<void> {
  const jstMs = Date.now() + 9 * 60 * 60_000;
  const now = new Date(jstMs);
  const checkPeriod = now.toISOString().slice(0, -1) + '+09:00';

  // 直近1時間のメッセージログからエラーパターンを推定
  // (実際のLINE APIエラーはログに残らないが、送信成功率から推定)
  const oneHourAgo = new Date(jstMs - 60 * 60_000).toISOString().slice(0, -1) + '+09:00';

  const sentMessages = await db
    .prepare(
      `SELECT COUNT(*) as count FROM messages_log
       WHERE direction = 'outgoing' AND created_at >= ?`,
    )
    .bind(oneHourAgo)
    .first<{ count: number }>();

  const totalSent = sentMessages?.count ?? 0;

  // LINE APIにヘルスチェックリクエスト
  let errorCode: number | null = null;
  let errorCount = 0;

  try {
    const response = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${account.channel_access_token}` },
    });

    if (!response.ok) {
      errorCode = response.status;
      errorCount = 1;
    }
  } catch {
    errorCode = 0; // ネットワークエラー
    errorCount = 1;
  }

  // リスクレベル判定
  let riskLevel = 'normal';
  if (errorCode === 403) {
    riskLevel = 'danger'; // BAN の可能性
  } else if (errorCode === 429) {
    riskLevel = 'warning'; // レート制限
  } else if (totalSent > 5000) {
    riskLevel = 'warning'; // 大量送信の警告
  }

  // LINE プラン月間クォータの残量チェック (2026-09-01 事故対応)。毎時 tick のみ。
  // bot/info が失敗しているときはトークン自体が死んでいて quota API も
  // 失敗するだけなのでスキップする。チェック自体の失敗は fail-open
  // (getLinePlanQuotaShortfall 内) — 監視の一時障害で誤警報を出さない。
  // audience は lazy に渡す: 上限なしプランのアカウントでは COUNT 自体走らない。
  if (quotaOpts.checkQuota && errorCode === null) {
    const shortfall = await getLinePlanQuotaShortfall(
      new LineClient(account.channel_access_token),
      () => countDeliverableAudience(db, account.id, quotaOpts.includeLegacyNullRows),
    );
    if (shortfall) {
      // 残0 = 一括配信が全滅する状態なので danger。残があるが全員分に足りない
      // 段階は warning (403 由来の danger はそのまま維持)。
      if (shortfall.remaining === 0) {
        riskLevel = 'danger';
      } else if (riskLevel === 'normal') {
        riskLevel = 'warning';
      }
      // 通知は月次 dedup (notifyQuotaAlert 内)。ヘルスログの「状態変化時のみ
      // 記録」とは独立に判定されるので、ログが抑制されても通知は漏れない。
      const notified = await notifyQuotaAlert(db, {
        lineAccountId: account.id,
        accountName: account.name ?? null,
        shortfall,
        source: 'health-check',
      });
      // 不足が続く限り毎時ここを通るので、ログは実際に通知した回だけに絞る
      // (dedup で抑制された tick まで吐くと 1インシデントでログが埋まる)。
      if (notified) {
        console.error(
          `⚠️ クォータ不足検知: アカウント ${account.id} 残り${shortfall.remaining}通 / 配信対象${shortfall.audience}人`,
        );
      }
    }
  }

  // 直前の記録と同じ状態なら書かない。この関数は分足の tick ごとに呼ばれるので、
  // 毎回 INSERT すると異常が1件も無いアカウントでも 1日1,440行のゴミが積み上がる
  // (2026-08-26 実測: 43テナント・24時間で 53,908行)。ヘルスログは「チェックした
  // 記録」ではなく「状態が変わった履歴」で、UI (apps/web/src/app/health/page.tsx)
  // も最新50件をそのまま並べるだけなので、同じ状態の連投は履歴を潰すだけになる。
  // risk_level が同じでもエラーコードが変われば別の事象なので、両方を比較する。
  const [latest] = await getAccountHealthLogs(db, account.id, 1);
  if (latest && latest.risk_level === riskLevel && (latest.error_code ?? null) === errorCode) {
    return;
  }

  // checkQuota=false の tick はクォータを再評価していないので、error_code なしの
  // warning/danger (クォータ不足または大量送信由来) を 'normal' で上書きしない。
  // 上書きすると不足継続中に毎時 warning↔normal の振動行が積まれ (状態変化 dedup が
  // 防ぐはずだったログ洪水)、最新行を読む health UI が毎時55分間 normal を表示する。
  // 解除判定は次の毎時 tick (checkQuota=true) が行う。403/429 等 error_code 付きの
  // 状態は quota と無関係なので従来どおり即時解除される。
  if (
    !quotaOpts.checkQuota &&
    riskLevel === 'normal' &&
    latest &&
    latest.risk_level !== 'normal' &&
    (latest.error_code ?? null) === null
  ) {
    return;
  }

  await createAccountHealthLog(db, {
    lineAccountId: account.id,
    errorCode: errorCode ?? undefined,
    errorCount,
    checkPeriod,
    riskLevel,
  });

  // danger はクォータ残0 でも立つようになったため、BAN 警告は 403 のときだけ出す
  // (クォータ側は上の quota チェック内で専用メッセージを出している)。
  if (riskLevel === 'danger' && errorCode === 403) {
    console.error(`⚠️ BAN検知: アカウント ${account.id} で403エラー発生。即座に確認が必要。`);
  }
}
