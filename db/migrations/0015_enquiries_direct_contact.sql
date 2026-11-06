-- Student enquiry -> owner lead -> direct contact.
--
-- Reuses the existing `leads` table (0001_init) instead of creating a second
-- pipeline. The added columns carry exactly what the enquiry form collects
-- beyond property/student/budget/move-in/message, plus the owner's private
-- follow-up notes.
--
-- Phone privacy: `shared_phone` is a snapshot of the number the student
-- consented to share for THIS enquiry. It is only ever returned to the lead's
-- owner, and only while `phone_shared = 1`. `users.phone` is never joined into
-- an owner response, so withdrawing consent (or editing the profile) cannot
-- silently re-expose a number that was never shared.

ALTER TABLE leads ADD COLUMN student_name TEXT;
ALTER TABLE leads ADD COLUMN college TEXT;
ALTER TABLE leads ADD COLUMN room_type TEXT;
ALTER TABLE leads ADD COLUMN phone_shared INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN shared_phone TEXT;
ALTER TABLE leads ADD COLUMN owner_notes TEXT;
-- First time the owner's contact details were unlocked for this lead
-- (analytics only; the value is a timestamp, never an identity).
ALTER TABLE leads ADD COLUMN contact_viewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_property_created ON leads(property_id, created_at);

-- Single owner preference: "allow students to contact me directly through
-- Call and WhatsApp after submitting an enquiry". The older per-channel flags
-- (0010) are kept for history but are no longer read for gating; owners who
-- had either channel on keep working contact after this migration.
ALTER TABLE owner_listings ADD COLUMN contact_direct INTEGER NOT NULL DEFAULT 0;
UPDATE owner_listings SET contact_direct = 1 WHERE contact_whatsapp = 1 OR contact_show_phone = 1;

-- Enquiry funnel events. A separate table from pg_engagement_events because
-- its CHECK constraint enumerates a fixed vocabulary and SQLite cannot widen
-- it in place. Aggregates only: no phone numbers, no free text, no student
-- identity beyond the acting user id (used for dedupe, never for reports).
CREATE TABLE IF NOT EXISTS lead_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  listing_id TEXT NOT NULL,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ENQUIRY_STARTED',
    'ENQUIRY_SUBMITTED',
    'OWNER_CONTACT_DETAILS_VIEWED',
    'OWNER_CALL_CLICKED',
    'OWNER_WHATSAPP_CLICKED',
    'LEAD_STATUS_CHANGED'
  )),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_events_listing_type ON lead_events(listing_id, event_type);
CREATE INDEX IF NOT EXISTS idx_lead_events_type_created ON lead_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events(lead_id);
