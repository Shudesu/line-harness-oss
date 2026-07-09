-- staff_blocks: 担当者の単発予定ブロック
CREATE TABLE IF NOT EXISTS staff_blocks (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  block_date TEXT NOT NULL,      -- YYYY-MM-DD (JST)
  start_time TEXT NOT NULL,      -- HH:MM（終日は 00:00）
  end_time TEXT NOT NULL,        -- HH:MM（終日は 24:00）
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_blocks_staff_date ON staff_blocks(staff_id, block_date);
