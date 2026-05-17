-- Phase 1 age bucket compatibility: explicitly track "3歳以下".
-- Keep existing 3-bucket columns for backward compatibility.

ALTER TABLE reservation_menus ADD COLUMN price_under_three INTEGER;
ALTER TABLE reservation_menus ADD COLUMN capacity_count_under_three INTEGER NOT NULL DEFAULT 0 CHECK (capacity_count_under_three IN (0, 1));

ALTER TABLE reservations ADD COLUMN under_three_count INTEGER NOT NULL DEFAULT 0 CHECK (under_three_count >= 0);

ALTER TABLE reservation_items ADD COLUMN under_three_count INTEGER NOT NULL DEFAULT 0;
