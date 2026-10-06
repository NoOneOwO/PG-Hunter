-- PG Hunter — Campus Creator programme.
--
-- Backs the "Earn with PG Hunter" funnel: a signed-in user applies to become a
-- creator, an admin approves or rejects the application, approved creators get
-- assigned PGs to shoot, submit the work, and are paid per approved assignment.
--
-- Three tables, deliberately separate:
--
--   creator_profiles     one application/profile per user (UNIQUE user_id), so
--                        "register as a creator" is idempotent per account.
--   creator_assignments  the unit of work AND the unit of earning: a payout is
--                        attached to an assignment, and money is only counted
--                        once the assignment is approved. Keeping the amount on
--                        the assignment means earnings can never be invented in
--                        the UI — they are always a sum of real rows.
--   creator_referrals    owners who signed up through a creator's share link.
--                        A referral is a lead, not a payment: the payout is
--                        still recorded as an assignment, so no fake revenue.
--
-- status values are constrained in SQL so a typo can never write a status the
-- API/UI does not understand.

CREATE TABLE IF NOT EXISTS creator_profiles (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name      TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  -- Comma-separated localities/areas the creator can cover. Free text on
  -- purpose: the coverage map is a preference, not a foreign key.
  areas          TEXT NOT NULL DEFAULT '',
  primary_skill  TEXT NOT NULL DEFAULT 'video' CHECK (primary_skill IN ('video', 'photo', 'both')),
  bio            TEXT NOT NULL DEFAULT '',
  portfolio_url  TEXT,
  equipment      TEXT,
  availability   TEXT,
  -- Payout address. Optional at application time, required before payment.
  payout_upi     TEXT,
  referral_code  TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes   TEXT,
  reviewed_at    TEXT,
  reviewed_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_creator_profiles_status ON creator_profiles(status);

CREATE TABLE IF NOT EXISTS creator_assignments (
  id               TEXT PRIMARY KEY,
  creator_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  pg_name          TEXT NOT NULL DEFAULT '',
  locality         TEXT,
  city             TEXT,
  brief            TEXT,
  -- Whole rupees. Stored as an integer so a sum is exact.
  payout           INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'assigned'
                     CHECK (status IN ('assigned', 'in_progress', 'submitted', 'approved', 'rejected')),
  due_at           TEXT,
  submission_note  TEXT,
  submission_url   TEXT,
  submitted_at     TEXT,
  reviewed_at      TEXT,
  rejected_reason  TEXT,
  paid_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_creator_assignments_creator ON creator_assignments(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_assignments_status ON creator_assignments(status);

CREATE TABLE IF NOT EXISTS creator_referrals (
  id                TEXT PRIMARY KEY,
  creator_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'signed_up'
                      CHECK (status IN ('signed_up', 'listed', 'paid')),
  note              TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_creator_referrals_creator ON creator_referrals(creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_referrals_code ON creator_referrals(code);
