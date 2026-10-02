-- PG Hunter — Phase 3A: engagement event log + current-state reactions + student experiences
-- Source of truth documentation (see src/lib/server/engagement.ts):
--   pg_engagement_events = immutable-ish historical log (VIEW/SAVE/UNSAVE/LIKE/DISLIKE/UNLIKE/UNDISLIKE/ENQUIRY/SHARE)
--   pg_reactions         = current user reaction state (UNIQUE listing+user, one row per user per PG)
--   saved_pgs            = current wishlist state (UNIQUE user+property, existing table)
--   pg_experiences       = student-generated experiences (moderated, pending by default)
--   listing_events       = legacy owner analytics (impression/view) — kept for backward compat, not used for new stats
-- listing_id is TEXT without FK to allow mock IDs (prop_*) alongside D1 owner_listings.id (UUID). Public pages still use
-- src/data/properties.ts mock data; engagement tables accept both. Do NOT invent a second source of truth.
-- Future migration to D1 public listings will reuse same TEXT id space; no fragile mapping needed now.

-- Engagement event log: every meaningful user action, anonymous views allowed (user_id NULL), no raw IP stored.
CREATE TABLE IF NOT EXISTS pg_engagement_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('VIEW','SAVE','UNSAVE','LIKE','DISLIKE','UNLIKE','UNDISLIKE','ENQUIRY','SHARE')),
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pg_engagement_listing_created ON pg_engagement_events(listing_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pg_engagement_user_created ON pg_engagement_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pg_engagement_listing_type ON pg_engagement_events(listing_id, event_type);
CREATE INDEX IF NOT EXISTS idx_pg_engagement_session ON pg_engagement_events(session_id, listing_id);

-- Current reaction state: one row per user+listing, reaction is like|dislike, toggling updates row, removing deletes it.
CREATE TABLE IF NOT EXISTS pg_reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   TEXT NOT NULL CHECK (reaction IN ('like','dislike')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(listing_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pg_reactions_listing ON pg_reactions(listing_id);
CREATE INDEX IF NOT EXISTS idx_pg_reactions_user ON pg_reactions(user_id);

-- Student experiences (reviews): pending by default, only approved appear publicly. Authenticated users only.
CREATE TABLE IF NOT EXISTS pg_experiences (
  id         TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  content    TEXT NOT NULL CHECK (length(content) >= 10 AND length(content) <= 2000),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','spam')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pg_experiences_listing ON pg_experiences(listing_id);
CREATE INDEX IF NOT EXISTS idx_pg_experiences_listing_status ON pg_experiences(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_experiences_user ON pg_experiences(user_id);

-- Improve saves count query (existing table had only user index, not property)
CREATE INDEX IF NOT EXISTS idx_saved_pgs_property ON saved_pgs(property_id);
