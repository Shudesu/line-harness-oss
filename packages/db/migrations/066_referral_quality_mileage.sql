-- 066_referral_quality_mileage.sql
-- Reward both sides of a healthy referral: the referred friend receives their
-- normal action miles, while the introducer receives a fixed quality bonus.

ALTER TABLE tags ADD COLUMN referral_mileage_reward INTEGER NOT NULL DEFAULT 0
  CHECK (referral_mileage_reward >= 0);

INSERT OR IGNORE INTO mileage_rules
  (id, program_id, name, event_type, source, amount, initial_status,
   conditions, is_active, created_at, updated_at)
VALUES
  ('builtin-purchase-completed', 'default', '購入完了',
   'purchase_completed', 'stripe', 50, 'available',
   '{"uniquePerSubject":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-referral-webinar-completed', 'default', '紹介者：ウェビナー視聴完了',
   'webinar_completed', 'webinar', 30, 'available',
   '{"beneficiary":"referrer","uniquePerReferredFriendPerSubject":true,"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-referral-booking-created', 'default', '紹介者：予約到達',
   'booking_created', NULL, 50, 'available',
   '{"beneficiary":"referrer","uniquePerReferredFriend":true,"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-referral-purchase-completed', 'default', '紹介者：購入到達',
   'purchase_completed', 'stripe', 100, 'available',
   '{"beneficiary":"referrer","uniquePerReferredFriend":true,"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'));
