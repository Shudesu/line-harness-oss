-- 046_ltp_tracking.sql
-- L-TRACK 互換: ltp（任意パラメータ）を ref_tracking に追加
-- 半角英数字10文字以内のカスタムパラメータ。クリエイティブごとのユーザー照合に使う。
-- L-TRACK の ltrack_lp.js と同じ仕様で、検証は app 側で行う。

ALTER TABLE ref_tracking ADD COLUMN ltp TEXT;

CREATE INDEX IF NOT EXISTS idx_ref_tracking_ltp ON ref_tracking (ltp) WHERE ltp IS NOT NULL;
