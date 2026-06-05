-- 047_skip_liff.sql
-- L-TRACK 互換: 認証画面スキップモード
-- skip_liff=1 のとき、/t/:linkId は LIFF 経由を完全にスキップし、
-- original_url（line.me/R/ti/p/@xxx）に直接302リダイレクトする。
-- friend 紐付けは webhook の follow イベント受信時に時間窓+IP+UA で確率突合する。
-- L-TRACK と同じ「CVR1.5倍」モード。確定的紐付け（既存LIFFモード）と選択可能。

ALTER TABLE tracked_links ADD COLUMN skip_liff INTEGER NOT NULL DEFAULT 0;
