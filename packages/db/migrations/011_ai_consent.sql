-- migration 011: AI consent columns for friends table
-- T38 で適用。DEFAULT 1 = AI返信有効（全ユーザーがデフォルトでAI返信対象）
-- ai_consent = 0 でオプトアウト
ALTER TABLE friends ADD COLUMN ai_consent INTEGER NOT NULL DEFAULT 1;
ALTER TABLE friends ADD COLUMN ai_consent_updated_at TEXT;
CREATE INDEX IF NOT EXISTS idx_friends_ai_consent ON friends(ai_consent);
