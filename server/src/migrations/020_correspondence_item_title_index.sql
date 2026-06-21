-- Speeds the correspondence-item -> document resolution fallback in
-- routes/correspondents.ts. When an item has no matching document by source_url,
-- it falls back to matching on (type, normalized title, date). The
-- `lower(trim(title))` expression cannot use a plain title index, forcing a scan
-- of every document of that type per page row. This expression index matches the
-- predicate exactly so SQLite seeks straight to the title candidates.
--
-- Resolution stays dynamic at query time (documents may be ingested after their
-- correspondence items), so this is a pure read optimization with no behavior
-- change — not a denormalized column that could go stale.

CREATE INDEX IF NOT EXISTS idx_documents_type_title_norm
  ON documents(type, lower(trim(title)));
