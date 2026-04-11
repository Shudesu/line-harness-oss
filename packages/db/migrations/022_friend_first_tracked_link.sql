-- Add first_tracked_link_id to friends to authoritatively attribute a friend
-- to the campaign they entered through. Set ONCE on first friend-add (or
-- first form-link push for an existing friend) and never overwritten —
-- this prevents an attacker from claiming another campaign's reward by
-- swapping ?ref= in the form URL.
ALTER TABLE friends ADD COLUMN first_tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL;
