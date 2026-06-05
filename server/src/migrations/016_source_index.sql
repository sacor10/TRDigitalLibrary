-- Index documents.source so the browse/search source-repository facet
-- (GROUP BY documents.source) and the first-class `source` filter stay cheap
-- at full-corpus scale (tens of thousands of rows).
CREATE INDEX IF NOT EXISTS idx_documents_source
  ON documents(source);
