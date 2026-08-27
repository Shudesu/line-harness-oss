/**
 * BAN検知モニター — cronトリガーで定期実行
 *
 * LINE APIのエラー率を監視し、BAN リスクを検出する
 * 403/429 エラーのパターンを分析してリスクレベルを判定
 */

import {
  getLineAccounts,
  createAccountHealthLog,
  getAccountHealthLogs,
} from '@line-crm/db';

export async function checkAccountHealth(
  db: D1Database,
): Promise<void> {
  const accounts = await getLineAccounts(db);

  for (const account of accounts) {
    if (!account.is_active) continue;

    try {
      await checkSingleAccount(db, account);
    } catch (err) {
      console.error(`ヘルスチェックエラー (account ${account.id}):`, err);
    }
  }
}

async function checkSingleAccount(
  db: D1Database,
  account: { id: string; channel_access_token: string },
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

  await createAccountHealthLog(db, {
    lineAccountId: account.id,
    errorCode: errorCode ?? undefined,
    errorCount,
    checkPeriod,
    riskLevel,
  });

  if (riskLevel === 'danger') {
    console.error(`⚠️ BAN検知: アカウント ${account.id} で403エラー発生。即座に確認が必要。`);
  }
}
