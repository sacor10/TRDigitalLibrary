-- Idempotency keys for the library DB.
--
-- documents.id is already the PRIMARY KEY (see 001_init.sql), so re-runs of the
-- TEI and LoC ingests converge via ON CONFLICT(id) DO UPDATE / DO NOTHING.
-- This migration adds two additional natural-key safeguards required for the
-- Turso migration:
--
-- 1. A partial UNIQUE INDEX on documents.source_url. The LoC adapter derives
--    documents.id from the LoC item URL and stores the LoC item permalink in
--    source_url; if a future ingest path ever changes how it derives `id`
--    from the same source_url, this index forces the database to reject the
--    duplicate instead of silently inserting a second row for the same
--    upstream record. The index is partial (WHERE source_url IS NOT NULL) so
--    legacy rows that pre-date sourceUrl recording — and any future bespoke
--    imports without an external URL — are unaffected.
--
-- 2. A documents.tei_source_hash TEXT column. ingest-tei stores the SHA-256 of
--    the raw TEI XML here; on subsequent runs ingest-tei reads the column for
--    a given document id and short-circuits the parse + write when the hash
--    is unchanged. This is what gives the no-op rebuild path its "finishes in
--    seconds" guarantee while still letting legitimate corrections to a TEI
--    file flow through automatically when the hash differs.
--
-- Both statements are safe on an already-populated Turso DB because the
-- schema_migrations table in server/src/db.ts skips any migration whose id is
-- already recorded; this file is only ever executed once per database.

CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_source_url_unique
  ON documents(source_url)
  WHERE source_url IS NOT NULL;

ALTER TABLE documents ADD COLUMN tei_source_hash TEXT;
