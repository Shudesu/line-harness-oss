-- 012_attendance.sql
-- QRコード勤怠管理（出退勤記録）

-- calendar_bookings に出退勤カラムを追加
ALTER TABLE calendar_bookings ADD COLUMN check_in_at TEXT;
ALTER TABLE calendar_bookings ADD COLUMN check_out_at TEXT;
ALTER TABLE calendar_bookings ADD COLUMN actual_hours REAL;

-- jobs に勤怠用トークンを追加（QRコードに埋め込む）
ALTER TABLE jobs ADD COLUMN attendance_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_attendance_token ON jobs (attendance_token);
