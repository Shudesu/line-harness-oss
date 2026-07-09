import { LineClient } from '@line-crm/line-sdk';

export type NotificationKind =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'day_before'
  | 'hours_before';

export const BOOKING_NOTIFICATION_KINDS = [
  'requested',
  'approved',
  'rejected',
  'expired',
  'day_before',
  'hours_before',
] as const satisfies readonly NotificationKind[];

export const BOOKING_NOTIFICATION_PLACEHOLDERS = [
  '{menu}',
  '{staff}',
  '{datetime}',
  '{hours}',
] as const;

export const BOOKING_NOTIFICATION_SETTINGS_KEY = 'booking_notification_templates';

export type BookingNotificationTemplates = Partial<Record<NotificationKind, string>>;

export interface NotificationContext {
  menuName: string;
  staffName: string;
  startsAtJst: string; // 例: "2026-05-10 14:00"
  hoursBefore: number;
}

export const BOOKING_NOTIFICATION_DEFAULT_TEMPLATES: Record<NotificationKind, string> = {
  requested:
    '予約リクエストを受け付けました。\nメニュー: {menu}\n担当: {staff}\n日時: {datetime}\n\nお店からの返信をお待ちください。',
  approved:
    '予約が確定しました。\nメニュー: {menu}\n担当: {staff}\n日時: {datetime}\n\n変更・キャンセルはお店に直接ご連絡ください。',
  rejected:
    '申し訳ありません、ご希望の枠でお取りできませんでした。\n別の日時で再度お試しください。',
  expired:
    '予約リクエストが 24 時間返信が無かったため、期限切れになりました。\nメニュー: {menu}\n担当: {staff}\n日時: {datetime}',
  day_before:
    '明日のご予約のお知らせです。\nメニュー: {menu}\n担当: {staff}\n日時: {datetime}',
  hours_before:
    '本日のご予約まであと {hours} 時間です。\nメニュー: {menu}\n担当: {staff}\n日時: {datetime}',
};

function applyNotificationPlaceholders(template: string, ctx: NotificationContext): string {
  return template
    .replaceAll('{menu}', ctx.menuName)
    .replaceAll('{staff}', ctx.staffName)
    .replaceAll('{datetime}', ctx.startsAtJst)
    .replaceAll('{hours}', String(ctx.hoursBefore));
}

export function renderNotificationText(
  kind: NotificationKind,
  ctx: NotificationContext,
  templates?: BookingNotificationTemplates,
): string {
  const customTemplate = templates?.[kind];
  if (typeof customTemplate === 'string' && customTemplate.length > 0) {
    return applyNotificationPlaceholders(customTemplate, ctx);
  }
  return applyNotificationPlaceholders(BOOKING_NOTIFICATION_DEFAULT_TEMPLATES[kind], ctx);
}

export async function getBookingTemplates(
  db: D1Database,
  lineAccountId: string,
): Promise<BookingNotificationTemplates> {
  try {
    const row = await db
      .prepare(`SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`)
      .bind(lineAccountId, BOOKING_NOTIFICATION_SETTINGS_KEY)
      .first<{ value: string }>();
    if (!row?.value) return {};

    const parsed = JSON.parse(row.value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const templates: BookingNotificationTemplates = {};
    const record = parsed as Record<string, unknown>;
    for (const kind of BOOKING_NOTIFICATION_KINDS) {
      const value = record[kind];
      if (typeof value === 'string' && value.length > 0) {
        templates[kind] = value;
      }
    }
    return templates;
  } catch {
    return {};
  }
}

export interface SendNotificationParams {
  channelAccessToken: string;
  toLineUserId: string;
  kind: NotificationKind;
  ctx: NotificationContext;
  templates?: BookingNotificationTemplates;
}

export async function sendBookingNotification(params: SendNotificationParams): Promise<void> {
  const text = renderNotificationText(params.kind, params.ctx, params.templates);
  const client = new LineClient(params.channelAccessToken);
  await client.pushMessage(params.toLineUserId, [{ type: 'text', text }]);
}

export type BookingNotificationSender = (params: SendNotificationParams) => Promise<void>;
