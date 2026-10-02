-- PG Hunter — P0 hardening: verification records + listing plan / expiry.
--
-- Two independent concerns that the product previously conflated:
--   1. moderation status      -> owner_listings.status (draft|pending|active|rejected)
--   2. verification status    -> owner_listings.verification_status (unverified|tier)
-- Publishing a listing must NEVER imply verification. The only way
-- `verification_status` may leave 'unverified' is by inserting an
-- approved row here, and that row demands a named reviewer, a timestamp,
-- a method and non-empty evidence.

-- ---------------------------------------------------------------------------
-- Append-only verification ledger.
--
-- Denormalising verified_at/by/method/evidence onto owner_listings is a
-- read cache of the newest approved row; this table is the source of truth
-- and the audit trail. Revocation is a status change, never a DELETE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_verifications (
  id            TEXT PRIMARY KEY,
  listing_id    TEXT NOT NULL REFERENCES owner_listings(id) ON DELETE CASCADE,

  -- Which badge tier this record grants.
  tier          TEXT NOT NULL CHECK (tier IN ('pg_hunter_verified', 'rishabh_irl_verified')),

  status        TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'revoked')),

  -- How the claim was established, and what backs it. `evidence` is required
  -- and must be non-blank: a bare "approved" click is not a verification.
  method        TEXT NOT NULL CHECK (method IN ('document_review', 'video_review', 'physical_visit')),
  evidence      TEXT NOT NULL CHECK (length(trim(evidence)) > 0),
  note          TEXT,

  -- Who verified, when, and how long the claim holds.
  verified_by   TEXT NOT NULL REFERENCES users(id),
  verified_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at    TEXT NOT NULL,

  revoked_at    TEXT,
  revoked_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason TEXT,

  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  -- A revoked record keeps its history but can never be silently re-approved.
  CHECK (status = 'approved' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_verifications_listing
  ON listing_verifications(listing_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_verifications_verifier
  ON listing_verifications(verified_by, created_at);

-- ---------------------------------------------------------------------------
-- Denormalised verification metadata on the listing (read cache).
-- Kept in sync by src/lib/server/verification.ts; never written directly by
-- owner or moderation routes.
-- ---------------------------------------------------------------------------
ALTER TABLE owner_listings ADD COLUMN verified_at TEXT;
ALTER TABLE owner_listings ADD COLUMN verified_by TEXT REFERENCES users(id);
ALTER TABLE owner_listings ADD COLUMN verification_method TEXT
  CHECK (verification_method IS NULL OR verification_method IN ('document_review', 'video_review', 'physical_visit'));
ALTER TABLE owner_listings ADD COLUMN verification_evidence TEXT;
ALTER TABLE owner_listings ADD COLUMN verification_expires_at TEXT;

-- ---------------------------------------------------------------------------
-- Plan window. Expiry is enforced on read: an expired listing is hidden from
-- public queries but is NEVER deleted, so the owner keeps their data and can
-- renew. `plan` is bookkeeping only — no payment processing exists yet.
--   basic    -> 15 days
--   verified -> 365 days
-- ---------------------------------------------------------------------------
ALTER TABLE owner_listings ADD COLUMN plan TEXT NOT NULL DEFAULT 'basic'
  CHECK (plan IN ('basic', 'verified'));
ALTER TABLE owner_listings ADD COLUMN plan_started_at TEXT;
ALTER TABLE owner_listings ADD COLUMN expires_at TEXT;

-- Public listing reads filter on (status, expires_at).
CREATE INDEX IF NOT EXISTS idx_listings_public
  ON owner_listings(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_owner
  ON owner_listings(owner_id, status);

-- Backfill a window for listings published before this migration so they do not
-- silently become permanent. They get the Basic 15-day window measured from
-- their creation date; anything already older than that correctly falls out of
-- public results and returns to its owner as "expired" for renewal.
UPDATE owner_listings
SET plan_started_at = created_at,
    expires_at      = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+15 days')
WHERE status = 'active' AND expires_at IS NULL;
