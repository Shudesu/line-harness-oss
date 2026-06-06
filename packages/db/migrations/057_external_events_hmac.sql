-- 056 を運用後に拡張するためのフォローアップ。
-- すでに作られた external_events に hmac_secret が無いケースに備える ALTER。
ALTER TABLE external_events ADD COLUMN hmac_secret TEXT;
