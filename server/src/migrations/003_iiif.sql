-- IIIF Image API 3.0 integration: store the canonical IIIF Presentation 3.0
-- manifest URL per document. Internet Archive serves these for free at
-- iiif.archive.org for public-domain holdings.
--
-- The migration runner (server/src/db.ts) wraps each statement in a guarded
-- exec, so re-running this file after the first apply is safe even though
-- SQLite has no IF NOT EXISTS for ALTER TABLE ADD COLUMN.
ALTER TABLE documents ADD COLUMN iiif_manifest_url TEXT;
