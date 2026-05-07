-- Structured list of people mentioned in a document's body, used to build the
-- correspondent network graph. Stored as a JSON array string to mirror the
-- existing `tags` column convention (see 001_init.sql); deserialized in
-- server/src/db.ts.
--
-- Existing rows receive '[]' automatically; no backfill is required.
ALTER TABLE documents ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]';
