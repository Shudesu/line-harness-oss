-- Phase 2-D: Stripe 商品販売 + 継続課金管理
--
-- 既存の stripe_events (webhook 受信ログ) はそのまま使う。
-- ここでは「販売する商品マスタ」と「友だちごとの継続課金状態」を追加する。
--
-- 想定運用:
-- 1. 管理者が /stripe-products で商品を作成 (内部で Stripe API 経由で Product + Price を作るのではなく、
--    Stripe Dashboard で先に作った price_id を貼り付ける方式。OAuth 連携は不要で簡単)
-- 2. 友だちには tracked-link や form 経由で Stripe Checkout URL を配信
-- 3. Checkout 成功時に webhook (stripe_events) が飛んできて、stripe_subscriptions が作られる/更新される

CREATE TABLE IF NOT EXISTS stripe_products (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT REFERENCES line_accounts(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  -- Stripe 側の Product / Price ID (前田さんが Dashboard で作成して貼り付ける)
  stripe_product_id TEXT,
  stripe_price_id   TEXT NOT NULL,
  -- 表示用 (Stripe 側と同じ値を入れる)
  amount            INTEGER NOT NULL,  -- 単位: 最小通貨単位 (円なら yen, USD なら cent)
  currency          TEXT NOT NULL DEFAULT 'jpy',
  -- 'one_time' (単発) / 'subscription' (継続)
  billing_type      TEXT NOT NULL CHECK (billing_type IN ('one_time', 'subscription')),
  -- subscription の場合の周期 (一致は Stripe price の interval と整合させる)
  recurring_interval TEXT CHECK (recurring_interval IN ('day','week','month','year')),
  -- 購入後の自動アクション (購入者限定アクション Phase 2-E と紐付け)
  on_purchase_tag_id      TEXT REFERENCES tags(id) ON DELETE SET NULL,
  on_purchase_scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
  on_purchase_message_template_id TEXT REFERENCES message_templates(id) ON DELETE SET NULL,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_products_account
  ON stripe_products (line_account_id, is_active);
CREATE INDEX IF NOT EXISTS idx_stripe_products_price
  ON stripe_products (stripe_price_id);

CREATE TABLE IF NOT EXISTS stripe_subscriptions (
  id                       TEXT PRIMARY KEY,
  friend_id                TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  stripe_product_id        TEXT REFERENCES stripe_products(id) ON DELETE SET NULL,
  stripe_subscription_id   TEXT UNIQUE,        -- Stripe Subscription オブジェクト ID
  stripe_customer_id       TEXT,
  status                   TEXT NOT NULL CHECK (status IN ('active','past_due','canceled','unpaid','incomplete','trialing','paused')),
  current_period_start     TEXT,
  current_period_end       TEXT,
  cancel_at                TEXT,
  canceled_at              TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_friend
  ON stripe_subscriptions (friend_id, status);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_product
  ON stripe_subscriptions (stripe_product_id);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_status
  ON stripe_subscriptions (status, current_period_end);

-- 購入完了 (one-time 含む) の履歴を友だち単位で見られるテーブル。
-- stripe_events から二次的に派生させるサマリ表 (検索性能のため)。
CREATE TABLE IF NOT EXISTS stripe_purchases (
  id                  TEXT PRIMARY KEY,
  friend_id           TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  stripe_product_id   TEXT REFERENCES stripe_products(id) ON DELETE SET NULL,
  stripe_event_id     TEXT,
  stripe_session_id   TEXT,
  amount              INTEGER NOT NULL,
  currency            TEXT NOT NULL,
  purchased_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_purchases_friend
  ON stripe_purchases (friend_id, purchased_at DESC);
