-- PG Hunter — Phase 4: admin moderation + reporting foundation
-- Keeps existing is_admin model (users.role = student|owner, users.is_admin = 1 is admin).
-- Do NOT create a third role. Admin can be student or owner.

-- Moderation audit trail: every admin action leaves a record. Never silently overwrite.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id            TEXT PRIMARY KEY,
  target_type   TEXT NOT NULL CHECK (target_type IN ('experience','pg','verification','report','media')),
  target_id     TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('APPROVED','REJECTED','SPAM','RESOLVED','DISMISSED','REVIEWING')),
  admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_moderation_target ON moderation_actions(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_moderation_admin ON moderation_actions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_created ON moderation_actions(created_at);

-- Reports foundation: users can report experiences/pgs/media/owners. Minimal for now, experience reporting sufficient.
CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  reporter_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_type   TEXT NOT NULL CHECK (target_type IN ('experience','pg','media','owner')),
  target_id     TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('spam','abuse','fake','inappropriate','other')),
  description   TEXT CHECK (description IS NULL OR length(description) <= 1000),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','resolved','dismissed')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at   TEXT,
  resolved_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
