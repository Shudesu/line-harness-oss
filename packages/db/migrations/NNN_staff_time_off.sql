-- Migration NNN: 予約不可時間 (staff_time_off / staff_time_off_rules)
--
-- 既存の勤務時間モデルは staff_shifts (日付指定) と staff_availability_rules
-- (曜日指定) の 2 段構えだが、どちらも「勤務している区間」を 1 本しか持てない
-- (staff_shifts は UNIQUE(staff_id, work_date))。そのため
--   - 昼休憩を挟む 2 部制 (09:00-12:00 / 13:00-18:00)
--   - 当日の外出・会議・急用といった一時的な離席
-- を空き枠から除外できない。
--
-- ここでは勤務区間を分割する方向ではなく、通し勤務から「穴」を空ける方向で解決する。
-- availability.ts の computeSlots は busy 区間を任意個数差し引ける (subtract) ため、
-- 既存予約と同じように busy へ積むだけでよく、空き枠計算そのものは変更しない。
--
-- テーブルを 2 つに分けるのは staff_shifts / staff_availability_rules と同じ理由で、
-- 定例 (毎週の休憩) を日付で有限生成すると期限切れになるため。
--
-- ⚠️ 勤務時間側とセマンティクスが異なる点に注意:
--    staff_shifts は同日の曜日ルールを「置き換える」が、
--    staff_time_off は同日の曜日ルールに「追加」される。
--    休憩 (定例) に加えて外出 (臨時) が入る、という重ね方をするのが自然なため。
--    したがって 1 スタッフ 1 日に複数行を許し、UNIQUE 制約は張らない。

CREATE TABLE IF NOT EXISTS staff_time_off (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  work_date   TEXT NOT NULL,    -- YYYY-MM-DD (JST)
  start_time  TEXT NOT NULL,    -- HH:MM (JST)
  end_time    TEXT NOT NULL,    -- HH:MM (JST)
  reason      TEXT,             -- 外出 / 会議 / 私用 など。運用メモで、判定には使わない
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_staff_time_off_staff_date
  ON staff_time_off (staff_id, work_date);

CREATE TABLE IF NOT EXISTS staff_time_off_rules (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time  TEXT NOT NULL,    -- HH:MM (JST)
  end_time    TEXT NOT NULL,    -- HH:MM (JST)
  reason      TEXT,             -- 休憩 など
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
CREATE INDEX IF NOT EXISTS idx_staff_time_off_rules_staff
  ON staff_time_off_rules (staff_id, weekday, is_active);
