-- Link a reservation resource to an existing Google Calendar connection.
-- For fresh installs this column already exists in schema.sql / 029_reservations.sql.
ALTER TABLE reservation_resources
  ADD COLUMN google_calendar_connection_id TEXT REFERENCES google_calendar_connections (id) ON DELETE SET NULL;
