-- 050: Tracked link expiration (deadline links)
--
-- Closes the gap with paid tools (UTAGE/L-step) that support "this link dies
-- N hours after the message reached you" campaign deadlines.
--
-- expires_at:                 absolute deadline as a JST ISO-8601 string (same
--                             format as jstNow()). Clicks after this moment are
--                             expired for everyone.
-- expires_minutes_after_send: per-friend relative deadline. Counted from the
--                             moment THAT friend last received a message
--                             containing this link (latest matching outgoing
--                             messages_log row). Requires the click to carry a
--                             friend identity (?f= / ?lu= / LIFF); anonymous
--                             clicks fall back to expires_at only.
-- expired_redirect_url:       where expired clicks are redirected. NULL shows
--                             a plain "link expired" page instead.
ALTER TABLE tracked_links ADD COLUMN expires_at TEXT;
ALTER TABLE tracked_links ADD COLUMN expires_minutes_after_send INTEGER;
ALTER TABLE tracked_links ADD COLUMN expired_redirect_url TEXT;
