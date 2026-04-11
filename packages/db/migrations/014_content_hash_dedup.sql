ALTER TABLE messages_log ADD COLUMN content_hash TEXT;
ALTER TABLE messages_log ADD COLUMN idempotency_key TEXT;
CREATE INDEX idx_messages_log_dedup ON messages_log (friend_id, content_hash, created_at);
CREATE UNIQUE INDEX idx_messages_log_idempotency_key
  ON messages_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
