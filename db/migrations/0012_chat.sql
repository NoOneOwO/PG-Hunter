-- PG Hunter — student <-> owner conversations.
--
-- A conversation is always between exactly two accounts: one student and one
-- owner. It can carry the listing it is about (`listing_id`), because "is this
-- PG still available in July?" is only answerable with the PG in view.
--
-- Read state is per side, not per message: `student_read_at` / `owner_read_at`
-- are watermarks that a single UPDATE moves forward. Per-message read rows
-- would be 2 rows per message for a feature (read receipts) nobody asked for.
--
-- Files sent in chat are R2 objects under `chat/{conversationId}/...` and are
-- NOT public: /api/media checks that the requester is a participant before it
-- streams one back (see src/pages/api/media/[...key].ts).

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  student_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_message_at TEXT,
  student_read_at TEXT,
  owner_read_at   TEXT,
  -- Backstop against a double-submitted "start conversation" click. NULL
  -- listing_id values compare as distinct in SQLite, which is why the server
  -- also looks the pair up before inserting.
  UNIQUE (student_id, owner_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_student ON conversations(student_id);
CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(owner_id);
CREATE INDEX IF NOT EXISTS idx_conversations_recent ON conversations(last_message_at);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'text'
                  CHECK (kind IN ('text', 'image', 'video', 'document', 'audio')),
  body            TEXT NOT NULL DEFAULT '',
  file_key        TEXT,
  file_name       TEXT,
  mime_type       TEXT,
  size_bytes      INTEGER,
  duration_ms     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- The thread query walks one conversation in insertion order; polling asks for
-- "everything after sequence N", which this index also serves.
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
