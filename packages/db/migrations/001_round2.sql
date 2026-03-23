-- Round 2 Migration: UUID Cross-Account, Conversion Tracking, Affiliates
-- Run this on existing Round 1 databases to add Round 2 tables

-- Add user_id to friends for UUID linking
ALTER TABLE friends ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends (user_id);

-- Internal UUID users
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT,
  phone        TEXT,
  external_id  TEXT,
  display_name TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone);
CREATE INDEX IF NOT EXISTS idx_users_external_id ON users (external_id);

-- LINE Account Management
CREATE TABLE IF NOT EXISTS line_accounts (
  id                   TEXT PRIMARY KEY,
  channel_id           TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  channel_access_token TEXT NOT NULL,
  channel_secret       TEXT NOT NULL,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conversion Points
CREATE TABLE IF NOT EXISTS conversion_points (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  event_type TEXT NOT NULL,
  value      REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conversion Events
CREATE TABLE IF NOT EXISTS conversion_events (
  id                  TEXT PRIMARY KEY,
  conversion_point_id TEXT NOT NULL REFERENCES conversion_points (id) ON DELETE CASCADE,
  friend_id           TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  user_id             TEXT,
  affiliate_code      TEXT,
  metadata            TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversion_events_point ON conversion_events (conversion_point_id);
CREATE INDEX IF NOT EXISTS idx_conversion_events_friend ON conversion_events (friend_id);
CREATE INDEX IF NOT EXISTS idx_conversion_events_affiliate ON conversion_events (affiliate_code);

-- Affiliates
CREATE TABLE IF NOT EXISTS affiliates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  commission_rate REAL NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Affiliate Clicks
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id           TEXT PRIMARY KEY,
  affiliate_id TEXT NOT NULL REFERENCES affiliates (id) ON DELETE CASCADE,
  url          TEXT,
  ip_address   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_affiliate ON affiliate_clicks (affiliate_id);

-- Admin Users (if not already present)
CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
