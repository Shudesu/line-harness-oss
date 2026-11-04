-- Apply only to the independent plugin's D1, never the L Harness database.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS delivery_slots (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL,
  arrival_date TEXT NOT NULL, shipping_date TEXT NOT NULL,
  UNIQUE(plan_id, arrival_date)
);
CREATE TABLE IF NOT EXISTS paid_periods (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, payment_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  friend_id TEXT NOT NULL, line_account_id TEXT NOT NULL,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  delivery_count INTEGER NOT NULL CHECK(delivery_count BETWEEN 1 AND 366),
  shipping TEXT NOT NULL, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'blocked' CHECK(status IN ('blocked','ready')),
  error TEXT, UNIQUE(provider, payment_id),
  UNIQUE(provider, subscription_id, period_start)
);
CREATE TABLE IF NOT EXISTS delivery_orders (
  id TEXT PRIMARY KEY, period_id TEXT NOT NULL REFERENCES paid_periods(id),
  slot_id TEXT NOT NULL REFERENCES delivery_slots(id),
  arrival_date TEXT NOT NULL, shipping_date TEXT NOT NULL,
  shipping TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK(status IN ('scheduled','preparing','shipped','delivered','canceled')),
  tracking_number TEXT,
  UNIQUE(period_id, slot_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(status, arrival_date);
