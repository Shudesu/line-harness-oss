import { LineClient } from '@line-crm/line-sdk';

export type NotificationKind =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'day_before'
  | 'hours_before';

/** 運営者（アカウント所有者）向けの通知種別。予約者向けとは文面も宛先も別。 */
export type OwnerNotificationKind = 'owner_new_booking' | 'owner_cancelled';

export interface NotificationContext {
  menuName: string;
  staffName: string;
  startsAtJst: string; // 例: "2026-05-10 14:00"
  hoursBefore: number;
  /** オンライン会議URL（Zoom / Google Meet）。対面予約では undefined。 */
  conferenceUrl?: string | null;
}

export function renderNotificationText(
  kind: NotificationKind,
  ctx: NotificationContext,
): string {
  const detail = `\nメニュー: ${ctx.menuName}\n担当: ${ctx.staffName}\n日時: ${ctx.startsAtJst}`;
  const conference = ctx.conferenceUrl ? `\n\n参加URL:\n${ctx.conferenceUrl}` : '';
  switch (kind) {
    case 'requested':
      return `予約リクエストを受け付けました。${detail}\n\n担当者からの返信をお待ちください。`;
    case 'approved':
      return `予約が確定しました。${detail}${conference}\n\n変更・キャンセルはこのトークからご連絡ください。`;
    case 'rejected':
      return `申し訳ありません、ご希望の枠でお取りできませんでした。\n別の日時で再度お試しください。`;
    case 'expired':
      return `予約リクエストが 24 時間返信が無かったため、期限切れになりました。${detail}`;
    case 'day_before':
      return `明日のご予約のお知らせです。${detail}${conference}`;
    case 'hours_before':
      return `本日のご予約まであと ${ctx.hoursBefore} 時間です。${detail}${conference}`;
  }
}

export interface OwnerNotificationContext extends NotificationContext {
  /** 予約者の表示名。 */
  customerName: string;
}

export function renderOwnerNotificationText(
  kind: OwnerNotificationKind,
  ctx: OwnerNotificationContext,
): string {
  const detail =
    `\nお相手: ${ctx.customerName}\nメニュー: ${ctx.menuName}\n担当: ${ctx.staffName}\n日時: ${ctx.startsAtJst}`;
  switch (kind) {
    case 'owner_new_booking':
      return `【新規予約】${detail}${ctx.conferenceUrl ? `\n参加URL: ${ctx.conferenceUrl}` : ''}`;
    case 'owner_cancelled':
      return `【予約キャンセル】${detail}`;
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

export interface SendOwnerNotificationParams {
  channelAccessToken: string;
  toLineUserId: string;
  kind: OwnerNotificationKind;
  ctx: OwnerNotificationContext;
}

export async function sendOwnerBookingNotification(
  params: SendOwnerNotificationParams,
): Promise<void> {
  const text = renderOwnerNotificationText(params.kind, params.ctx);
  const client = new LineClient(params.channelAccessToken);
  await client.pushMessage(params.toLineUserId, [{ type: 'text', text }]);
}

export type BookingNotificationSender = (params: SendNotificationParams) => Promise<void>;
