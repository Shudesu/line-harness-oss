-- 求人リマインド・口コミ依頼の送信フラグ
ALTER TABLE calendar_bookings ADD COLUMN reminder_day_before_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendar_bookings ADD COLUMN reminder_day_of_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendar_bookings ADD COLUMN review_request_sent INTEGER NOT NULL DEFAULT 0;
