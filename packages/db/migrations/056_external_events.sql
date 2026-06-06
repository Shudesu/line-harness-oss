-- L-TRACK 互換: 外部イベント定義 + 受信ログ
--
-- 外部イベント = EC カート等のシステムが、ユーザーアクション(購入等)発生時に
-- POST で harness に成果通知を送る仕組み。
-- L-TRACK では「成果受け取りURL」を発行し、event/lineid/fbclid/gclid/ttclid を
-- パラメータで受け取って、対応する CAPI に流す。

CREATE TABLE IF NOT EXISTS external_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,    -- URL に埋め込む識別子 (例: cv_purchase)
  name TEXT NOT NULL,
  line_account_id TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  -- ポストバック設定
  capi_platform TEXT,                -- 'meta' | 'google' | 'tiktok' | 'x' | null
  capi_event_name TEXT,              -- 例: 'Purchase'
  default_value INTEGER,             -- 円換算 (任意)
  -- HMAC 共有秘密 (送信元の正当性検証)。NULL のときは検証スキップ（dev 用）。
  hmac_secret TEXT,
  -- メモ
  memo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS external_event_receipts (
  id TEXT PRIMARY KEY,
  external_event_id TEXT NOT NULL REFERENCES external_events (id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  -- 受信時にクライアントから渡されたクリックID（友だち時点のものではなく受信時点）
  fbclid TEXT,
  gclid TEXT,
  ttclid TEXT,
  twclid TEXT,
  event_value INTEGER,
  raw_payload TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'capi_sent', 'capi_failed')),
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_external_events_key ON external_events (event_key);
CREATE INDEX IF NOT EXISTS idx_external_events_account ON external_events (line_account_id) WHERE line_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_event_receipts_event ON external_event_receipts (external_event_id);
CREATE INDEX IF NOT EXISTS idx_external_event_receipts_friend ON external_event_receipts (friend_id) WHERE friend_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_event_receipts_status ON external_event_receipts (status);
