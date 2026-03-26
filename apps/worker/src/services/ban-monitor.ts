/**
 * BAN検知モニター — cronトリガーで定期実行
 *
 * LINE APIのエラー率を監視し、BAN リスクを検出する
 * 403/429 エラーのパターンを分析してリスクレベルを判定
 */

import {
  getLineAccounts,
  createAccountHealthLog,
} from '@line-crm/db';

export async function checkAccountHealth(
  db: D1Database,
  opts?: { adminLineUserId?: string; lineAccessToken?: string },
): Promise<void> {
  const accounts = await getLineAccounts(db);

  for (const account of accounts) {
    if (!account.is_active) continue;

    try {
      await checkSingleAccount(db, account, opts);
    } catch (err) {
      console.error(`ヘルスチェックエラー (account ${account.id}):`, err);
    }
  }
}

async function checkSingleAccount(
  db: D1Database,
  account: { id: string; channel_access_token: string },
  opts?: { adminLineUserId?: string; lineAccessToken?: string },
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

  await createAccountHealthLog(db, {
    lineAccountId: account.id,
    errorCode: errorCode ?? undefined,
    errorCount,
    checkPeriod,
    riskLevel,
  });

  // 管理者へのLINE通知（danger/warningレベル）
  if ((riskLevel === 'danger' || riskLevel === 'warning') && opts?.adminLineUserId && opts?.lineAccessToken) {
    const emoji = riskLevel === 'danger' ? '🚨' : '⚠️';
    const label = riskLevel === 'danger' ? 'BAN検知（403）' : 'レート制限（429）';
    const message = `${emoji} ${label}\nアカウント: ${account.id}\nエラーコード: ${errorCode}\n直近1h送信数: ${totalSent}\n確認時刻: ${checkPeriod}`;

    try {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${opts.lineAccessToken}`,
        },
        body: JSON.stringify({
          to: opts.adminLineUserId,
          messages: [{ type: 'text', text: message }],
        }),
      });
    } catch (notifyErr) {
      console.error('管理者通知の送信に失敗:', notifyErr);
    }
  }

  if (riskLevel === 'danger') {
    console.error(`⚠️ BAN検知: アカウント ${account.id} で403エラー発生。即座に確認が必要。`);
  }
}
