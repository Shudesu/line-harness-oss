import { LineClient } from '@line-crm/line-sdk';

export type NotificationKind =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'day_before'
  | 'hours_before';

export interface NotificationContext {
  menuName: string;
  staffName: string;
  startsAtJst: string; // 例: "2026-05-10 14:00"
  hoursBefore: number;
}

export function renderNotificationText(
  kind: NotificationKind,
  ctx: NotificationContext,
): string {
  const detail = `\nメニュー: ${ctx.menuName}\n担当: ${ctx.staffName}\n日時: ${ctx.startsAtJst}`;
  switch (kind) {
    case 'requested':
      return `予約リクエストを受け付けました。${detail}\n\nお店からの返信をお待ちください。`;
    case 'approved':
      return `予約が確定しました。${detail}\n\n変更・キャンセルはお店に直接ご連絡ください。`;
    case 'rejected':
      return `申し訳ありません、ご希望の枠でお取りできませんでした。\n別の日時で再度お試しください。`;
    case 'expired':
      return `予約リクエストが 24 時間返信が無かったため、期限切れになりました。${detail}`;
    case 'day_before':
      return `明日のご予約のお知らせです。${detail}`;
    case 'hours_before':
      return `本日のご予約まであと ${ctx.hoursBefore} 時間です。${detail}`;
  }
}

export interface SendNotificationParams {
  channelAccessToken: string;
  toLineUserId: string;
  kind: NotificationKind;
  ctx: NotificationContext;
}

export async function sendBookingNotification(params: SendNotificationParams): Promise<void> {
  const text = renderNotificationText(params.kind, params.ctx);
  const client = new LineClient(params.channelAccessToken);
  await client.pushMessage(params.toLineUserId, [{ type: 'text', text }]);
}

export type BookingNotificationSender = (params: SendNotificationParams) => Promise<void>;

// ---------------------------------------------------------------------------
// スタッフ通知
//
// 顧客向け通知 (上) と分けている理由は宛先と文面が別物のため。顧客には
// 「お店からの返信をお待ちください」、スタッフには承認を促す内容を送る。
//
// 宛先はスタッフ本人が公式アカウントを友だち追加した friends 行
// (staff.notify_friend_id)、および account_settings の
// 'booking_notify_friend_ids' に列挙された friends.id (店長など全件受け取る人)。
//
// ⚠️ push はアカウントの配信通数を消費する。
// ---------------------------------------------------------------------------

export const BOOKING_NOTIFY_RECIPIENTS_KEY = 'booking_notify_friend_ids';

export interface StaffNotificationContext extends NotificationContext {
  customerName: string;
  adminUrl?: string;
}

export function renderStaffNotificationText(ctx: StaffNotificationContext): string {
  const lines = [
    '新しい予約リクエストが入りました。',
    '',
    `お客様: ${ctx.customerName}`,
    `メニュー: ${ctx.menuName}`,
    `担当: ${ctx.staffName}`,
    `日時: ${ctx.startsAtJst}`,
    '',
    // 24 時間で expired になるため、放置されないよう期限を明示する
    '24 時間以内に承認されないと自動でキャンセル扱いになります。',
  ];
  if (ctx.adminUrl) lines.push('', `管理画面: ${ctx.adminUrl}`);
  return lines.join('\n');
}

/**
 * 通知先の friends.id を集める。指名スタッフの通知先と、アカウント共通の
 * 通知先を結合し重複を除く。順序は「指名スタッフ → 共通」で安定させる。
 */
export function resolveStaffRecipients(
  staffNotifyFriendId: string | null | undefined,
  accountRecipientsJson: string | null | undefined,
): string[] {
  const out: string[] = [];
  if (staffNotifyFriendId) out.push(staffNotifyFriendId);
  if (accountRecipientsJson) {
    try {
      const parsed: unknown = JSON.parse(accountRecipientsJson);
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
        }
      }
    } catch {
      // 設定が壊れていても予約自体は成功させる。通知だけ諦める。
    }
  }
  return out;
}
