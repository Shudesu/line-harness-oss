-- 051_link_clicks_attribution.sql
-- L-TRACK 互換: link_clicks にアトリビューション情報を追加
-- 認証スキップモード（skip_liff=1）の時、クリック時点ではfriend_idが未確定。
-- IP/UA/ltp/fbclid 等を click 時点で保存し、後の follow webhook で時間窓+IP+UA 突合で friend_id を埋める。

ALTER TABLE link_clicks ADD COLUMN ltp TEXT;
ALTER TABLE link_clicks ADD COLUMN fbclid TEXT;
ALTER TABLE link_clicks ADD COLUMN gclid TEXT;
ALTER TABLE link_clicks ADD COLUMN ttclid TEXT;
ALTER TABLE link_clicks ADD COLUMN twclid TEXT;
ALTER TABLE link_clicks ADD COLUMN utm_source TEXT;
ALTER TABLE link_clicks ADD COLUMN utm_medium TEXT;
ALTER TABLE link_clicks ADD COLUMN utm_campaign TEXT;
ALTER TABLE link_clicks ADD COLUMN utm_content TEXT;
ALTER TABLE link_clicks ADD COLUMN utm_term TEXT;
ALTER TABLE link_clicks ADD COLUMN user_agent TEXT;
ALTER TABLE link_clicks ADD COLUMN ip_address TEXT;
ALTER TABLE link_clicks ADD COLUMN ua_fingerprint TEXT;
ALTER TABLE link_clicks ADD COLUMN matched_at TEXT;
ALTER TABLE link_clicks ADD COLUMN match_confidence REAL;
ALTER TABLE link_clicks ADD COLUMN match_strategy TEXT;

-- 時間窓マッチング用インデックス（friend_id IS NULL の未マッチ click を高速検索）
CREATE INDEX IF NOT EXISTS idx_link_clicks_unmatched_fingerprint
  ON link_clicks (ua_fingerprint, ip_address, clicked_at)
  WHERE friend_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_link_clicks_unmatched_time
  ON link_clicks (clicked_at)
  WHERE friend_id IS NULL;
