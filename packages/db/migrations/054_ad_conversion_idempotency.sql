-- L-TRACK 互換: 広告 CV 送信の冪等キー
--
-- ad_conversion_logs に「同 platform × 同 friend × 同 event × 同 click_id」で
-- 既に status='sent' のものがあれば再送しない、を支えるための UNIQUE INDEX。
--
-- なぜ partial: 'failed' は再試行したい・'pending' は中間状態、'sent' のみ重複
-- 防止対象。status='sent' でのみ uniqueness を強制すれば既存データを壊さない。

CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_conversion_logs_sent_idemp
  ON ad_conversion_logs (ad_platform_id, friend_id, event_name, click_id)
  WHERE status = 'sent';
