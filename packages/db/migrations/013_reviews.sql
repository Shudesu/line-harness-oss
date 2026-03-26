-- 013_reviews.sql
-- 相互評価（園⇔ワーカー）

CREATE TABLE IF NOT EXISTS reviews (
  id             TEXT PRIMARY KEY,
  booking_id     TEXT NOT NULL REFERENCES calendar_bookings (id) ON DELETE CASCADE,
  job_id         TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  reviewer_type  TEXT NOT NULL CHECK (reviewer_type IN ('worker', 'nursery')),
  reviewer_id    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  punctuality    INTEGER CHECK (punctuality BETWEEN 1 AND 5),
  communication  INTEGER CHECK (communication BETWEEN 1 AND 5),
  skill          INTEGER CHECK (skill BETWEEN 1 AND 5),
  attitude       INTEGER CHECK (attitude BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_reviews_booking ON reviews (booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_job ON reviews (job_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews (target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON reviews (reviewer_id, reviewer_type);
