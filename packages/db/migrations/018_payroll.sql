-- 報酬管理・源泉徴収・振込テーブル

-- 報酬レコード（勤務完了ごとに1行）
CREATE TABLE IF NOT EXISTS payroll_records (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL,
  booking_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL,
  nursery_name TEXT NOT NULL,
  work_date TEXT NOT NULL,
  -- 勤務時間
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  actual_hours REAL,
  -- 報酬計算
  hourly_rate INTEGER NOT NULL,
  gross_amount INTEGER NOT NULL,          -- 税引前報酬（時給×時間）
  transport_fee INTEGER NOT NULL DEFAULT 0, -- 交通費
  -- 源泉徴収
  withholding_tax INTEGER NOT NULL DEFAULT 0, -- 源泉徴収額
  net_amount INTEGER NOT NULL,             -- 手取り（gross + transport - withholding）
  -- 振込
  payment_method TEXT NOT NULL DEFAULT 'monthly', -- 'spot' or 'monthly'
  payment_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'paid'
  paid_at TEXT,
  -- メタ
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (friend_id) REFERENCES friends(id),
  FOREIGN KEY (booking_id) REFERENCES calendar_bookings(id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_friend ON payroll_records(friend_id);
CREATE INDEX IF NOT EXISTS idx_payroll_status ON payroll_records(payment_status);
CREATE INDEX IF NOT EXISTS idx_payroll_work_date ON payroll_records(work_date);
CREATE INDEX IF NOT EXISTS idx_payroll_method ON payroll_records(payment_method);

-- ワーカーの振込設定
CREATE TABLE IF NOT EXISTS worker_payment_settings (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL UNIQUE,
  default_payment_method TEXT NOT NULL DEFAULT 'monthly', -- 'spot' or 'monthly'
  bank_name TEXT,
  branch_name TEXT,
  account_type TEXT,       -- 'ordinary' or 'current'
  account_number TEXT,
  account_holder TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (friend_id) REFERENCES friends(id)
);

-- 源泉徴収率テーブル（年次で変更可能）
CREATE TABLE IF NOT EXISTS withholding_tax_rates (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  threshold_amount INTEGER NOT NULL,  -- この金額以下は非課税
  rate REAL NOT NULL,                  -- 税率（例: 0.1021 = 10.21%）
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 2026年の源泉徴収率を初期投入（日額報酬が9,300円超で10.21%）
INSERT INTO withholding_tax_rates (id, year, threshold_amount, rate, effective_from, created_at)
VALUES ('wt-2026', 2026, 9300, 0.1021, '2026-01-01', datetime('now'));
