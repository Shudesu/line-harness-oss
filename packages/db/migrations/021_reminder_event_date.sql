-- Add event date (起点日時) to reminders and allow step editing
ALTER TABLE reminders ADD COLUMN event_date TEXT;
ALTER TABLE reminders ADD COLUMN event_label TEXT NOT NULL DEFAULT 'イベント日時';
