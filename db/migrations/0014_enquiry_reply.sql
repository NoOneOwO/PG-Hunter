-- PG Hunter — a conversation the owner opened in answer to a student's enquiry.
--
-- The student's inbox labels that thread ("reply to your enquiry about …"), and
-- the label has to be right before the owner has typed anything and after every
-- reload — so it is stored on the conversation rather than inferred from who
-- happened to write first.
--
-- `enquiry_lead_id` points at the lead that opened it. It is nullable (every
-- older conversation, and every chat started from a listing page, stays NULL),
-- and ON DELETE SET NULL keeps an old thread readable if a lead ever goes away.
-- A new column with a NULL default is the only form SQLite accepts for a
-- foreign key added by ALTER TABLE.

ALTER TABLE conversations
  ADD COLUMN enquiry_lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL;
