-- 071: オンライン会議URLを予約に紐づける。
--
-- 個別面談（オンライン相談）用途では、予約確定時に Zoom / Google Meet の
-- 会議URLを発行して予約者へ案内する必要がある。従来は Google Meet の URL を
-- meet_consultations（ウェビナーCTA経路）にしか保存しておらず、通常の
-- LIFF 予約経路では会議URLがどこにも残らなかった。
--
-- provider は 'zoom' | 'google_meet'。external_id は再発行・削除に使う
-- プロバイダ側のID（Zoom の meeting id など）。Google Meet は
-- カレンダーイベントに紐づくため external_id は NULL になる。
ALTER TABLE bookings ADD COLUMN conference_provider TEXT;
ALTER TABLE bookings ADD COLUMN conference_url TEXT;
ALTER TABLE bookings ADD COLUMN conference_external_id TEXT;
