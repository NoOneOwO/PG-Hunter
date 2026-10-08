-- PG Hunter — pages the team sets up on an owner's behalf.
--
-- At launch an owner only creates an account; the team fills in their PG page
-- from the admin panel (the owner is usually more comfortable on WhatsApp than
-- in a listing form). This records that fact instead of hiding it:
--
--   created_by     users.id of whoever created the row — an admin when the team
--                  set the page up, the owner when they wrote it themselves.
--   admin_managed  1 while the team is running this page for the owner.
--
-- The columns exist so the arrangement can be switched off later without a
-- data migration: when owners take over their own pages, flip the flag to 0 and
-- nothing else has to change. `owner_id` remains the single source of truth for
-- whose listing it is (enquiries, verification and payouts all follow it).
--
-- SQLite allows ADD COLUMN only with a constant default, and both columns are
-- nullable/defaulted, so no table rebuild is needed.
ALTER TABLE owner_listings ADD COLUMN created_by TEXT;
ALTER TABLE owner_listings ADD COLUMN admin_managed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_owner_listings_admin_managed ON owner_listings(admin_managed);
