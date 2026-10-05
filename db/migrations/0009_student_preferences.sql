-- PG Hunter — student hunt preferences on the user profile.
--
-- These five fields were half-wired into the API before they had storage:
-- POST /api/auth/register and PUT /api/profile referenced columns that did not
-- exist, which made sign-up and profile save return 500s. The profile UI now
-- exposes them, so the columns are the missing half of that feature.
--
-- All nullable on purpose: existing accounts keep working and every field is
-- optional. SQLite allows ADD COLUMN without a default as long as the column is
-- nullable, and D1 applies each statement separately, so no table rebuild is
-- needed.
--
--   city              Where the student is hunting (free text, matches listing cities)
--   moving_in_month   'YYYY-MM' target move-in month
--   budget_pref       Coarse budget band id ('under-10' | '10-15' | '15-20' | '20-plus')
--   availability      Free text: when they can move / visit
--   message_to_owners Reusable intro line the enquiry form prefills
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN moving_in_month TEXT;
ALTER TABLE users ADD COLUMN budget_pref TEXT;
ALTER TABLE users ADD COLUMN availability TEXT;
ALTER TABLE users ADD COLUMN message_to_owners TEXT;
