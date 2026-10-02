-- Owner analytics events for dashboard reach graphs.
CREATE TABLE IF NOT EXISTS listing_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES owner_listings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'view')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_listing_events_listing ON listing_events(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_events_type_created ON listing_events(event_type, created_at);
