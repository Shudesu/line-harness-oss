// ウェビナー予約リマインド — 5分毎 cron から実行。
// セッション選択メニュー (webinar_registrations) で予約した友だちに、開始
// LEAD_SECONDS 前〜セッション中の間に視聴リンクを1回だけプッシュする。
// LINE 送信は必ず Harness の /line-api プロキシを通し、messages_log に残す。
// X-Line-Retry-Key に registration id を使うことで、送信成功後の DB 更新前に
// worker が落ちても LINE 側で二重送信を防ぎつつ、次 tick で安全に再試行できる。

import {
  getDueWebinarRegistrations,
  markWebinarRegistrationNotified,
  getFriendById,
  getLineAccountById,
  type Webinar,
} from '@line-crm/db';
import { addJitter, sleep } from './stealth.js';
import { pushViaHarnessProxy } from './line-proxy-send.js';
import type { HarnessProxyDispatch } from './line-proxy-send.js';

const LEAD_SECONDS = 300;

export type WebinarProxyDeliveryOptions = {
  proxyBaseUrl: string;
  defaultAccessToken: string;
  defaultLiffId: string | null;
  proxyDispatch?: HarnessProxyDispatch;
};

export function buildWebinarUrl(
  liffId: string,
  slug: string,
  sessionStartAt: number,
): string {
  return (
    `https://liff.line.me/${liffId}/?page=webinar&slug=${encodeURIComponent(slug)}` +
    `&sessionStartAt=${sessionStartAt}&liffId=${liffId}`
  );
}

function fmtJstDateTime(epochSeconds: number): string {
  const d = new Date((epochSeconds + 9 * 3600) * 1000);
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return (
    `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${days[d.getUTCDay()]}) ` +
    `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  );
}

async function resolveDeliveryConfig(
  db: D1Database,
  accountId: string | null,
  options: WebinarProxyDeliveryOptions,
): Promise<{ accessToken: string; liffId: string | null }> {
  if (accountId) {
    const account = await getLineAccountById(db, accountId);
    if (account) {
      return {
        accessToken: account.channel_access_token,
        liffId:
          ((account as unknown as Record<string, string | null>).liff_id as string | null) ??
          options.defaultLiffId,
      };
    }
  }
  return {
    accessToken: options.defaultAccessToken,
    liffId: options.defaultLiffId,
  };
}

export async function processWebinarReminders(
  db: D1Database,
  options: WebinarProxyDeliveryOptions,
): Promise<{ sent: number; failed: number }> {
  const now = Math.floor(Date.now() / 1000);
  const due = await getDueWebinarRegistrations(db, now, LEAD_SECONDS);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < due.length; i++) {
    const reg = due[i];
    try {
      if (i > 0) await sleep(addJitter(50, 200));
      const friend = await getFriendById(db, reg.friend_id);
      if (!friend || !friend.is_following) {
        // ブロック済み等は送らず消化 (毎 tick 積み直さない)
        await markWebinarRegistrationNotified(db, reg.id);
        continue;
      }
      const { accessToken, liffId } = await resolveDeliveryConfig(db, reg.account_id, options);
      if (!liffId) {
        failed++;
        continue;
      }
      const head =
        reg.session_start_at - now > 60 ? '🔴 まもなくライブ配信が始まります' : '🔴 ライブ配信が始まりました';
      await pushViaHarnessProxy(options.proxyBaseUrl, accessToken, friend.line_user_id, [
        {
          type: 'text',
          text:
            `${head}\n\n「${reg.title}」\n${fmtJstDateTime(reg.session_start_at)}〜\n\n` +
            `こちらから参加してください👇\n${buildWebinarUrl(liffId, reg.slug, reg.session_start_at)}` +
            `\n\n※この専用リンクは、閉じた後も何度でも開けます。`,
        },
      ], reg.id, options.proxyDispatch);
      // 実送信が成功した後だけ通知済みにする。失敗時は NULL のままなので次 tick で再試行。
      await markWebinarRegistrationNotified(db, reg.id);
      sent++;
    } catch (err) {
      console.error('webinar reminder error:', reg.id, err);
      failed++;
    }
  }
  return { sent, failed };
}

/** 予約直後の受付確認プッシュ (fire-and-forget。失敗しても予約自体は成立) */
export async function sendWebinarRegistrationConfirmation(
  db: D1Database,
  webinar: Pick<Webinar, 'account_id' | 'title' | 'slug'>,
  friendId: string,
  sessionStartAt: number,
  options: WebinarProxyDeliveryOptions,
): Promise<void> {
  try {
    const friend = await getFriendById(db, friendId);
    if (!friend || !friend.is_following) return;
    const { accessToken, liffId } = await resolveDeliveryConfig(db, webinar.account_id, options);
    if (!liffId) return;
    const admissionUrl = buildWebinarUrl(liffId, webinar.slug, sessionStartAt);
    await pushViaHarnessProxy(options.proxyBaseUrl, accessToken, friend.line_user_id, [
      {
        type: 'text',
        text:
          `✅ ${fmtJstDateTime(sessionStartAt)} の回で受付しました\n\n` +
          `「${webinar.title}」\n\n` +
          `専用の入場リンクです👇\n${admissionUrl}\n\n` +
          `開始5分前にも同じリンクをお送りします。` +
          `閉じた後も何度でも開けます。`,
      },
    ], crypto.randomUUID(), options.proxyDispatch);
  } catch (err) {
    console.error('webinar registration confirmation error:', err);
  }
}
