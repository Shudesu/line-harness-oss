-- Track Google OAuth access token expiry for automatic refresh.
ALTER TABLE google_calendar_connections
  ADD COLUMN access_token_expires_at TEXT;
