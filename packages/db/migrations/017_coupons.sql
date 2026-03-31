-- Coupon management
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'fixed', -- 'fixed' | 'percentage'
  discount_value REAL NOT NULL DEFAULT 0,
  max_claims INTEGER, -- NULL = unlimited
  expires_at TEXT, -- NULL = no expiry
  is_active INTEGER NOT NULL DEFAULT 1,
  line_account_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours'))
);

CREATE TABLE IF NOT EXISTS coupon_claims (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  redeemed_at TEXT, -- NULL = not yet redeemed
  UNIQUE(coupon_id, friend_id)
);
