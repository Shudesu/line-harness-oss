import { LineClient } from '@line-crm/line-sdk';

export type EventNotificationKind =
  | 'received_pending'
  | 'received_confirmed'
  | 'confirmed'
  | 'rejected'
  | 'cancelled_by_admin'
  | 'reminder_day_before'
  | 'reminder_hours_before';

export interface EventNotificationContext {
  eventName: string;
  startsAtJst: string;
  venueName?: string | null;
  venueUrl?: string | null;
  hoursBefore?: number;
  // 確定系 (received_confirmed / confirmed) の末尾に追記。空 / null は何もしない。
  confirmationExtra?: string | null;
  // リマインド系 (reminder_day_before / reminder_hours_before) の末尾に追記。
  reminderExtra?: string | null;
}

function appendExtra(base: string, extra: string | null | undefined): string {
  if (!extra) return base;
  const trimmed = extra.trim();
  if (trimmed.length === 0) return base;
  return `${base}\n\n${trimmed}`;
}

export function renderEventNotificationText(
  kind: EventNotificationKind,
  ctx: EventNotificationContext,
): string {
  const venueLine = ctx.venueName ? `\n会場: ${ctx.venueName}` : '';
  const venueUrlLine = ctx.venueUrl ? `\n${ctx.venueUrl}` : '';
  const detail = `\nイベント: ${ctx.eventName}\n日時: ${ctx.startsAtJst}${venueLine}${venueUrlLine}`;
  switch (kind) {
    case 'received_pending':
      return `イベント申込みを受け付けました。${detail}\n\n運営の承認をお待ちください。`;
    case 'received_confirmed':
      return appendExtra(
        `イベント予約が確定しました。${detail}\n\n変更・キャンセルは予約履歴画面からお願いします。`,
        ctx.confirmationExtra,
      );
    case 'confirmed':
      return appendExtra(
        `イベント予約が確定しました。${detail}\n\n変更・キャンセルは予約履歴画面からお願いします。`,
        ctx.confirmationExtra,
      );
    case 'rejected':
      return `申し訳ございません、今回のイベント予約はお受けできませんでした。${detail}`;
    case 'cancelled_by_admin':
      return `運営側でイベント予約をキャンセルさせていただきました。${detail}\n\n詳細は LINE にてご連絡ください。`;
    case 'reminder_day_before':
      return appendExtra(`【リマインド】明日イベントが開催されます。${detail}`, ctx.reminderExtra);
    case 'reminder_hours_before': {
      const hours = ctx.hoursBefore ?? 0;
      return appendExtra(
        `【リマインド】まもなくイベント開始です（あと ${hours} 時間）。${detail}`,
        ctx.reminderExtra,
      );
    }
  }
}

export interface SendEventNotificationParams {
  channelAccessToken: string;
  toLineUserId: string;
  kind: EventNotificationKind;
  ctx: EventNotificationContext;
}

export async function sendEventBookingNotification(
  params: SendEventNotificationParams,
): Promise<void> {
  const text = renderEventNotificationText(params.kind, params.ctx);
  const client = new LineClient(params.channelAccessToken);
  await client.pushMessage(params.toLineUserId, [{ type: 'text', text }]);
}

export type EventBookingNotificationSender = (
  params: SendEventNotificationParams,
) => Promise<void>;
