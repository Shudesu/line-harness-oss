-- L-TRACK 互換: クリック時の国情報を保存
--
-- Cloudflare Workers では request.cf?.country で2文字国コード(ISO 3166-1 alpha-2)が
-- 取れる。L-TRACK の CSV/友だち詳細にある「国」項目の互換のため。
--
-- ref_tracking にも同じく追加する（昇格時に引き継ぐため）。

ALTER TABLE link_clicks ADD COLUMN country TEXT;
ALTER TABLE ref_tracking ADD COLUMN country TEXT;

CREATE INDEX IF NOT EXISTS idx_link_clicks_country ON link_clicks (country) WHERE country IS NOT NULL;
