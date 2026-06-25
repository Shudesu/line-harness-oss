import { LineClient, type Message } from '@line-crm/line-sdk';

export type EventNotificationKind =
  | 'received_pending'      // 受付（承認制ON、未承認段階）
  | 'received_confirmed'    // 受付＝即時確定
  | 'confirmed'             // 後追い承認で確定
  | 'rejected'              // 拒否
  | 'cancelled_by_admin'    // 運営側でキャンセル
  | 'reminder_day_before'   // 前日 18:00 JST
  | 'reminder_hours_before';// 開始 N 時間前

export interface EventNotificationContext {
  eventName: string;
  startsAtJst: string; // 例: "2026-06-01 10:00"
  venueName?: string | null;
  venueUrl?: string | null;
  liffId?: string | null;
  hoursBefore?: number;
}

export function renderEventNotificationText(
  kind: EventNotificationKind,
  ctx: EventNotificationContext,
): string {
  const venueLine = ctx.venueName ? `\n会場: ${ctx.venueName}` : '';
  const detail = `\nイベント: ${ctx.eventName}\n日時: ${ctx.startsAtJst}${venueLine}`;
  switch (kind) {
    case 'received_pending':
      return `イベント申し込み予約を受け付けました。${detail}\n\n運営の承認をお待ちください。`;
    case 'received_confirmed':
      return `イベント予約が確定しました。${detail}\n\n変更・キャンセルは予約履歴画面からお願いします。`;
    case 'confirmed':
      return `イベント予約が確定しました。${detail}\n\n変更・キャンセルは予約履歴画面からお願いします。`;
    case 'rejected':
      return `申し訳ございません。既に定員に達してしまっていますので、今回のイベント予約はお受けできませんでした。${detail}`;
    case 'cancelled_by_admin':
      return `運営側でイベント予約をキャンセルさせていただきました。${detail}\n\n詳細は LINE にてご連絡ください。`;
    case 'reminder_day_before':
      return `【リマインド】明日イベントが開催されます。${detail}`;
    case 'reminder_hours_before': {
      const hours = ctx.hoursBefore ?? 0;
      return `【リマインド】まもなくイベント開始です（あと ${hours} 時間）。${detail}`;
    }
  }
}

function isActionableNotification(kind: EventNotificationKind): boolean {
  return kind === 'received_pending' || kind === 'received_confirmed' || kind === 'confirmed';
}

function buildLiffUrl(liffId: string, page: 'events' | 'event-me'): string {
  const encoded = encodeURIComponent(liffId);
  return `https://liff.line.me/${encoded}?page=${page}&liffId=${encoded}`;
}

export function renderEventNotificationMessage(
  kind: EventNotificationKind,
  ctx: EventNotificationContext,
): Message {
  const text = renderEventNotificationText(kind, ctx);
  const liffId = ctx.liffId?.trim();
  if (!liffId || !isActionableNotification(kind)) {
    return { type: 'text', text };
  }

  const title = kind === 'received_pending'
    ? 'イベント申し込み予約を受け付けました'
    : 'イベント予約が確定しました';
  const lead = kind === 'received_pending'
    ? '運営の承認をお待ちください。'
    : '変更・キャンセルは予約履歴画面からお願いします。';
  const isConfirmed = kind === 'received_confirmed' || kind === 'confirmed';
  const themeColor = isConfirmed ? '#2563EB' : '#06C755';
  const themeLight = isConfirmed ? '#EFF6FF' : '#ECFDF5';
  const themeText = isConfirmed ? '#1D4ED8' : '#047857';

  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: isConfirmed ? themeColor : themeLight,
            cornerRadius: 'md',
            paddingAll: '14px',
            contents: [
              {
                type: 'text',
                text: title,
                weight: 'bold',
                size: 'lg',
                color: isConfirmed ? '#FFFFFF' : themeText,
                wrap: true,
              },
            ],
          },
          {
            type: 'text',
            text: lead,
            size: 'sm',
            color: '#4b5563',
            wrap: true,
          },
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            margin: 'md',
            contents: [
              { type: 'text', text: `イベント: ${ctx.eventName}`, size: 'sm', color: '#111827', wrap: true },
              { type: 'text', text: `日時: ${ctx.startsAtJst}`, size: 'sm', color: '#111827', wrap: true },
              ...(ctx.venueName ? [{ type: 'text', text: `会場: ${ctx.venueName}`, size: 'sm', color: '#111827', wrap: true }] : []),
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: themeColor,
            height: 'md',
            action: {
              type: 'uri',
              label: 'イベント一覧を開く',
              uri: buildLiffUrl(liffId, 'events'),
            },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'md',
            action: {
              type: 'uri',
              label: '予約履歴を見る',
              uri: buildLiffUrl(liffId, 'event-me'),
            },
          },
        ],
      },
    },
  };
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
  const message = renderEventNotificationMessage(params.kind, params.ctx);
  const client = new LineClient(params.channelAccessToken);
  await client.pushMessage(params.toLineUserId, [message]);
}

export type EventBookingNotificationSender = (
  params: SendEventNotificationParams,
) => Promise<void>;
