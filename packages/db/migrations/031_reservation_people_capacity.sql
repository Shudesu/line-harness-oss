-- Add infant counts and capacity-consumption snapshots for reservations.
-- Existing rows keep their previous behavior: infant_count=0 and capacity_people=total_people.

ALTER TABLE reservation_menus ADD COLUMN price_infant INTEGER;
ALTER TABLE reservation_menus ADD COLUMN capacity_count_adult INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_adult IN (0, 1));
ALTER TABLE reservation_menus ADD COLUMN capacity_count_child INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_child IN (0, 1));
ALTER TABLE reservation_menus ADD COLUMN capacity_count_infant INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_infant IN (0, 1));

ALTER TABLE reservations ADD COLUMN infant_count INTEGER NOT NULL DEFAULT 0 CHECK (infant_count >= 0);
ALTER TABLE reservations ADD COLUMN capacity_people INTEGER NOT NULL DEFAULT 1 CHECK (capacity_people > 0);
UPDATE reservations SET capacity_people = total_people WHERE capacity_people = 1 AND total_people <> 1;

ALTER TABLE reservation_items ADD COLUMN infant_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reservation_items ADD COLUMN capacity_people INTEGER NOT NULL DEFAULT 1;
UPDATE reservation_items
SET capacity_people = COALESCE(
  (SELECT reservations.capacity_people FROM reservations WHERE reservations.id = reservation_items.reservation_id),
  adult_count + child_count,
  1
);
