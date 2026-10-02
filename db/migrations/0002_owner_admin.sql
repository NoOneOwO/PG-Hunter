-- PG Hunter — owner listings, media, verification, admin flag.
-- Follows the entity model in /ai/DATABASE_SCHEMA.md.

-- Admin is a separate capability on the users table (role stays student/owner).
-- SQLite allows ADD COLUMN with a constant NOT NULL DEFAULT.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Owner-created PG listings. Property *listings* finally live in D1; the
-- mock src/data/properties data remains for the public demo site.
CREATE TABLE IF NOT EXISTS owner_listings (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  property_type       TEXT NOT NULL DEFAULT 'pg',
  gender              TEXT NOT NULL DEFAULT 'co-ed',
  address             TEXT NOT NULL DEFAULT '',
  locality            TEXT NOT NULL DEFAULT '',
  city                TEXT NOT NULL DEFAULT 'Delhi',
  latitude            REAL,
  longitude           REAL,
  description         TEXT NOT NULL DEFAULT '',
  rules               TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  curfew              TEXT,
  food                TEXT NOT NULL DEFAULT '{}',   -- JSON {available, type, monthlyCost}
  amenity_slugs       TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'pending', 'active', 'rejected')),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (verification_status IN ('unverified', 'pg_hunter_verified', 'rishabh_irl_verified')),
  rejection_reason    TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_owner_listings_owner ON owner_listings(owner_id);
CREATE INDEX IF NOT EXISTS idx_owner_listings_status ON owner_listings(status);

-- Room/occupancy options per listing (rent lives at the room level).
CREATE TABLE IF NOT EXISTS listing_rooms (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES owner_listings(id) ON DELETE CASCADE,
  room_type  TEXT NOT NULL DEFAULT 'double',
  occupancy  TEXT NOT NULL DEFAULT 'Double sharing',
  rent       INTEGER NOT NULL,
  deposit    INTEGER NOT NULL DEFAULT 0,
  available  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_listing_rooms_listing ON listing_rooms(listing_id);

-- Media attached to listings: owner photos/documents (R2) and admin room-tour
-- videos (YouTube ids, MVP — see /ai/MASTER_ARCHITECTURE.md).
CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,
  listing_id  TEXT,
  type        TEXT NOT NULL CHECK (type IN ('photo', 'video', 'document')),
  provider    TEXT NOT NULL DEFAULT 'r2' CHECK (provider IN ('r2', 'youtube', 'unsplash')),
  external_id TEXT NOT NULL,          -- R2 object key or YouTube video id
  title       TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT,                   -- users.id
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_media_listing ON media(listing_id);

-- Credible documents submitted by owners to verify their PG.
CREATE TABLE IF NOT EXISTS verification_documents (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  TEXT,                   -- optional: document may cover a specific listing
  doc_type    TEXT NOT NULL DEFAULT 'identity',
  file_key    TEXT NOT NULL,          -- R2 object key (never served publicly)
  file_name   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'approved', 'rejected')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_verification_docs_owner ON verification_documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_verification_docs_status ON verification_documents(status);
