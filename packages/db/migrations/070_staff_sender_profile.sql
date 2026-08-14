-- Per-message sender override for operator replies.
--
-- Lets each staff member reply from the chat screen under their own icon and
-- display name instead of the shared account profile. LINE appends
-- `from '<account name>'` to the display name, so this identifies the person
-- without allowing impersonation of another business.
--
-- https://developers.line.biz/en/docs/messaging-api/icon-nickname-switch/
--   sender.name    — max 20 characters, must not contain "LINE"
--   sender.iconUrl — max 2000 characters, https URL of a JPEG/PNG image
--
-- Both columns are nullable: staff without a profile keep sending as the
-- account, which is the pre-existing behaviour.
ALTER TABLE staff_members ADD COLUMN sender_name TEXT;
ALTER TABLE staff_members ADD COLUMN sender_icon_url TEXT;
