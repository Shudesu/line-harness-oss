CREATE TABLE IF NOT EXISTS authorization_sessions (
  id TEXT PRIMARY KEY, reference_id TEXT NOT NULL UNIQUE, nonce TEXT NOT NULL,
  friend_id TEXT NOT NULL, plan_id TEXT NOT NULL, plan TEXT NOT NULL,
  shipping TEXT NOT NULL, line_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', expires_at TEXT NOT NULL, url TEXT,
  CHECK(status IN ('pending','accepted','declined','expired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_authorization
  ON authorization_sessions(friend_id,plan_id) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS paypay_subscriptions (
  id TEXT PRIMARY KEY, friend_id TEXT NOT NULL, plan_id TEXT NOT NULL, plan TEXT NOT NULL,
  shipping TEXT NOT NULL, line_account_id TEXT NOT NULL,
  user_authorization_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  period_start TEXT NOT NULL, next_charge_at TEXT NOT NULL, paid_through TEXT,
  retry_no INTEGER NOT NULL DEFAULT 0, unlink_pending INTEGER NOT NULL DEFAULT 0,
  CHECK(status IN ('pending','active','past_due','canceled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_paypay_friend_plan
  ON paypay_subscriptions(friend_id,plan_id) WHERE status IN ('pending','active','past_due');
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_paypay_authorization
  ON paypay_subscriptions(user_authorization_id) WHERE status IN ('pending','active','past_due') OR unlink_pending=1;
CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES paypay_subscriptions(id),
  period_start TEXT NOT NULL, period_end TEXT NOT NULL, retry_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing', result_code TEXT,
  payment_id TEXT, payload TEXT, delivery_status TEXT NOT NULL DEFAULT 'pending',
  CHECK(status IN ('processing','unknown','failed','completed')),
  CHECK(delivery_status IN ('pending','ready')),
  UNIQUE(subscription_id,period_start,retry_no)
);
