-- PG Hunter — manual UPI plan payments.
--
-- There is no payment gateway. An owner pays the platform's UPI id directly and
-- submits the UPI reference (UTR) here; an admin confirms that the money actually
-- arrived. Only a `confirmed` row counts as revenue, and only a confirmed row may
-- unlock a paid plan window. Nothing in the product may imply a payment
-- completed unless a row with status = 'confirmed' exists.
--
-- `amount_inr` is COPIED from the plan catalogue at submission time. Repricing a
-- plan later must never rewrite what an owner was asked to pay, so the billed
-- amount is frozen onto the row (this is the `price_paid` the 0008 migration
-- anticipated). The catalogue remains the single source of the *current* price.
--
-- Scope: `basic` is free (price 0) and needs no payment; in practice only paid
-- plans (currently `verified`) reach this table.

CREATE TABLE IF NOT EXISTS plan_payments (
  id            TEXT PRIMARY KEY,

  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The listing being upgraded. Nullable: an owner may pay before creating the
  -- listing, in which case the entitlement is applied when an admin confirms and
  -- the owner later attaches a listing. ON DELETE SET NULL keeps the payment
  -- (money is real) even if the listing is removed.
  listing_id    TEXT REFERENCES owner_listings(id) ON DELETE SET NULL,

  plan_slug     TEXT NOT NULL CHECK (plan_slug IN ('basic', 'verified')),
  -- Whole rupees, frozen at submission from the plan catalogue.
  amount_inr    INTEGER NOT NULL CHECK (amount_inr >= 0),

  method        TEXT NOT NULL DEFAULT 'upi' CHECK (method IN ('upi')),

  -- The UPI reference / UTR the owner entered after paying. Required and
  -- non-blank: "I paid" with no reference is not evidence of a payment.
  reference     TEXT NOT NULL CHECK (length(trim(reference)) > 0),
  payer_note    TEXT,

  status        TEXT NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted', 'confirmed', 'rejected')),

  submitted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- Set when an admin confirms or rejects. A rejected row keeps its history.
  reviewed_at   TEXT,
  reviewed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_note   TEXT,

  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- A decided row must name who decided it and when.
  CHECK (
    status = 'submitted'
    OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);

-- Owner's own payment history on the checkout page.
CREATE INDEX IF NOT EXISTS idx_plan_payments_owner
  ON plan_payments(owner_id, created_at);
-- The admin confirmation queue reads by status, newest first.
CREATE INDEX IF NOT EXISTS idx_plan_payments_status
  ON plan_payments(status, submitted_at);
-- Applying an entitlement to a listing on confirmation.
CREATE INDEX IF NOT EXISTS idx_plan_payments_listing
  ON plan_payments(listing_id);
