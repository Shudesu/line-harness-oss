-- Booking-tied reminder templates
--
-- これまで booking-notify.ts に Flex バブルがハードコードされていた
-- 24h/1h/5min の3窓を、reminders テーブルで管理可能にする。
--
-- - reminders.trigger_type = 'manual'  → 既存のカスタムリマインダ (reminder-delivery.ts)
-- - reminders.trigger_type = 'booking' → 予約紐付き自動リマインダ (booking-notify.ts)
--
-- booking 種別の reminder_steps.offset_minutes は「予約開始 N 分前」として解釈される。
-- message_content は { kind: 'booking_flex_v1', heading, noteText, primaryButton, secondaryButton } 形式の JSON。
-- buildBookingFlexFromSpec() がプレースホルダ展開と Flex 組立を行う。

ALTER TABLE reminders ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual';

-- 予約リマインダ(自動) — booking-notify が走らせる
INSERT INTO reminders (id, name, description, is_active, trigger_type)
VALUES (
  'sys_booking_reminder_v1',
  '予約リマインダ(自動)',
  '面談予約に対して 24h前 / 1h前 / 5分前 の3回送信される自動リマインダ。本文・ボタンを編集可能。',
  1,
  'booking'
);

-- 24時間前
INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
VALUES (
  'sys_booking_step_24h',
  'sys_booking_reminder_v1',
  1440,
  'flex',
  '{"kind":"booking_flex_v1","heading":"面談リマインド｜明日","noteText":"日程変更は下のボタン、その他のご相談はこのトークへ。","primaryButton":{"label":"Google Meetを開く","uri":"{{meet_url}}"},"secondaryButton":{"label":"日程を変更する","uri":"{{reschedule_url}}"}}'
);

-- 1時間前
INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
VALUES (
  'sys_booking_step_1h',
  'sys_booking_reminder_v1',
  60,
  'flex',
  '{"kind":"booking_flex_v1","heading":"面談リマインド｜1時間前","noteText":"日程変更は下のボタン、その他のご相談はこのトークへ。","primaryButton":{"label":"Google Meetを開く","uri":"{{meet_url}}"},"secondaryButton":{"label":"日程を変更する","uri":"{{reschedule_url}}"}}'
);

-- 5分前
INSERT INTO reminder_steps (id, reminder_id, offset_minutes, message_type, message_content)
VALUES (
  'sys_booking_step_5min',
  'sys_booking_reminder_v1',
  5,
  'flex',
  '{"kind":"booking_flex_v1","heading":"面談まもなく開始｜5分前","noteText":"日程変更は下のボタン、その他のご相談はこのトークへ。","primaryButton":{"label":"Google Meetを開く","uri":"{{meet_url}}"},"secondaryButton":{"label":"日程を変更する","uri":"{{reschedule_url}}"}}'
);
