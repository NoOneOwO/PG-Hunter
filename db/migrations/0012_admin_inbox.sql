-- PG Hunter — admin notification inbox state.
--
-- The admin inbox is DERIVED, never fabricated: items are built on read from
-- the real queue tables (pending listings, verification documents, experiences,
-- reports, creator applications and submitted creator work). Nothing about a
-- notification can be invented, because there is no notifications table to
-- write arbitrary rows into.
--
-- This table stores only each admin's "last seen" watermark, so the bell can
-- show a truthful unread count of items created since they last looked. One row
-- per admin (`user_id` PRIMARY KEY) keeps it small and idempotent.
--
-- If the table is missing, the inbox helper degrades to "everything is unread"
-- rather than failing the whole admin shell.

CREATE TABLE IF NOT EXISTS admin_inbox_state (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
