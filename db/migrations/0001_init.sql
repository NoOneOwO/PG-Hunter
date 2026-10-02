-- PG Hunter — initial schema for Cloudflare D1.
-- Mirrors the entity model in /ai/DATABASE_SCHEMA.md.

-- Users hold both auth credentials and profile data for the MVP.
-- Passwords are never stored raw: password_hash is PBKDF2-SHA256 (210k iters)
-- derived server-side with the per-user random salt.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  salt          TEXT,
  provider      TEXT NOT NULL DEFAULT 'email' CHECK (provider IN ('email', 'google')),
  name          TEXT NOT NULL DEFAULT '',
  phone         TEXT DEFAULT '',
  college_slug  TEXT,
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'owner')),
  avatar_url    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Opaque session tokens (httpOnly cookie). Expired rows are cleaned lazily.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Per-user shortlist. property_id references mock listings (src/data/properties)
-- until listings move into D1.
CREATE TABLE IF NOT EXISTS saved_pgs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_pgs_user ON saved_pgs(user_id);

-- Enquiries from students about a property.
CREATE TABLE IF NOT EXISTS leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id   TEXT NOT NULL,
  student_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  budget        TEXT,
  move_in_month TEXT,
  message       TEXT,
  source        TEXT NOT NULL DEFAULT 'web',
  status        TEXT NOT NULL DEFAULT 'new',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_leads_property_id ON leads(property_id);
CREATE INDEX IF NOT EXISTS idx_leads_student_id ON leads(student_id);
