-- PG Hunter — plan policy update: Basic is 14 days, ₹1,499 tier is "Annual Listing".
--
-- WHY A NEW MIGRATION (not an edit to 0008)
--   0008 seeded the original catalogue (Basic 15 days, "PG Hunter Verified").
--   A migration that has already been applied is history and must not be
--   rewritten: databases in the wild would silently keep the old values while a
--   fresh database would get the new ones. This migration is the authoritative
--   correction and runs after 0008 on every database.
--
-- WHAT CHANGED (business decisions, 2026-10)
--   1. Basic publication window: 15 days -> 14 days. The authoritative
--      enforcement lives in src/lib/verificationRules.ts (PLAN_WINDOW_DAYS);
--      duration_days here is the DISPLAY copy and must match it.
--   2. The ₹1,499 plan keeps its slug (`verified`, which also gates the
--      verification/visit workflow) but is displayed as "Annual Listing".
--
-- NOT changed: prices (Basic ₹0, Annual ₹1,499), the 365-day window, the
-- travel charge, or the visit/refund policy. No payment provider exists, so
-- nothing here implies a payment completed.

UPDATE plans
   SET duration_days   = 14,
       duration_label  = '14 days',
       features        = '["Live listing for 14 days","Receive student enquiries","Upload your own photos","Unverified badge"]',
       updated_at      = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE slug = 'basic';

UPDATE plans
   SET name       = 'Annual Listing',
       tagline    = 'A real team visits your PG, verifies it on camera and lists it for a year.',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE slug = 'verified';
