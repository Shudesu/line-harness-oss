-- 製品軸の追加。NULL = デフォルト製品(ai-shain-link)扱い＝既存データ無変更で後方互換
ALTER TABLE entry_routes ADD COLUMN project TEXT;
ALTER TABLE kb_articles ADD COLUMN project TEXT;
ALTER TABLE llm_response_cache ADD COLUMN project TEXT;
CREATE INDEX IF NOT EXISTS idx_kb_articles_project ON kb_articles (project);
CREATE INDEX IF NOT EXISTS idx_llm_response_cache_project ON llm_response_cache (project);
