-- ============================================================
-- 011: L-step移行 — 承認制フロー + プロフィール項目追加
-- ============================================================

-- 1. calendar_bookings に承認ステータス追加
-- 現在の status: pending/confirmed/cancelled
-- 新: pending → approved/denied/confirmed/cancelled
-- approval_note: 管理者コメント
ALTER TABLE calendar_bookings ADD COLUMN approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'denied'));
ALTER TABLE calendar_bookings ADD COLUMN approved_at TEXT;
ALTER TABLE calendar_bookings ADD COLUMN approval_note TEXT;

-- 2. user_profiles に追加項目
ALTER TABLE user_profiles ADD COLUMN date_of_birth TEXT;
ALTER TABLE user_profiles ADD COLUMN gender TEXT;
ALTER TABLE user_profiles ADD COLUMN allergies_medical TEXT;
ALTER TABLE user_profiles ADD COLUMN experience_years TEXT;
ALTER TABLE user_profiles ADD COLUMN bacterial_test_status TEXT;
ALTER TABLE user_profiles ADD COLUMN health_notes TEXT;
ALTER TABLE user_profiles ADD COLUMN terms_agreed_at TEXT;
