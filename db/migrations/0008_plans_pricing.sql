-- PG Hunter — P0: the pricing catalogue.
--
-- Prices were previously typed directly into page markup (₹0 and ₹1,499 in
-- src/pages/owner/plans/*.astro), which meant changing a business decision
-- required editing code, opening a PR and redeploying. Price is data, not
-- presentation. This table is the single source of truth for what a plan costs
-- and how long it runs.
--
-- Scope note: this holds the CATALOGUE only. It is not a payment system — there
-- are no orders, no payment records and no refunds, because no payment provider
-- exists yet. When payments arrive, the amount actually charged must be copied
-- onto the purchase record (the planned `listing_plans.price_paid`) so that
-- repricing later cannot rewrite what a customer was billed historically.
-- Nothing here may be used to imply a payment completed.
--
-- `slug` matches the values already constrained on owner_listings.plan
-- (migration 0006): 'basic' | 'verified'.
--
-- Stored as a plain JSON string literal rather than via SQLite's json() helper,
-- so the seed cannot depend on an optional SQLite extension being compiled in.

CREATE TABLE IF NOT EXISTS plans (
  -- Stable identifier used in code and on owner_listings.plan.
  slug                TEXT PRIMARY KEY CHECK (slug IN ('basic', 'verified')),

  name                TEXT NOT NULL,
  tagline             TEXT,

  -- Whole rupees. Deliberately INTEGER: no floating point near money.
  price_inr           INTEGER NOT NULL DEFAULT 0 CHECK (price_inr >= 0),

  -- An additional charge computed at booking (the verification visit's travel).
  -- No amount is stored because none is known until the visit is scheduled.
  has_travel_charge   INTEGER NOT NULL DEFAULT 0 CHECK (has_travel_charge IN (0, 1)),

  -- How long the plan's publication window runs, and how that window is
  -- described to the owner. These are DISPLAY values: the authoritative
  -- enforcement lives in src/lib/verificationRules.ts and must not be changed
  -- here, or the copy and the behaviour will disagree.
  duration_days       INTEGER NOT NULL CHECK (duration_days > 0),
  duration_label      TEXT NOT NULL,

  -- JSON string[] of what the plan includes. Rendered as the plan's bullet list.
  features            TEXT NOT NULL DEFAULT '[]',

  -- A note shown on the specific signup/checkout page, if the plan needs one.
  checkout_note       TEXT,

  -- Unlisting a plan is a flag change, never a DELETE: an owner may be on a
  -- plan that is no longer sold, and their listing must keep working.
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),

  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active, sort_order);

-- Seed the two plans with the values that are currently live in the markup, so
-- switching to this table changes no price and no wording.
INSERT OR IGNORE INTO plans
  (slug, name, tagline, price_inr, has_travel_charge, duration_days, duration_label,
   features, checkout_note, is_active, sort_order)
VALUES
  (
    'basic',
    'Basic Listing',
    'List your PG and start receiving enquiries.',
    0,
    0,
    15,
    '15 days',
    '["Live listing for 15 days","Receive student enquiries","Upload your own photos","Unverified badge"]',
    NULL,
    1,
    1
  ),
  (
    'verified',
    'PG Hunter Verified',
    'A real team visits your PG and verifies it on camera.',
    1499,
    1,
    365,
    '1 year',
    '["PG Hunter Verified badge for 1 year","Physical visit + photography","Video walkthrough on your listing","7–10 day visit window"]',
    'We aim to complete your visit within 7–10 days of payment. If we''re unable to schedule a visit within that window, we''ll refund the verification fee in full.',
    1,
    2
  );
