-- Per-document text embeddings for semantic / hybrid search. Mirrors the
-- document_sentiment precedent (PK FK + model_version/computed_at). The vector
-- is stored as a little-endian Float32 BLOB; `dim` records its length so a
-- model swap is detectable. At larger scale this column can be migrated to a
-- libSQL native F32_BLOB(dim) with a vector ANN index.
CREATE TABLE IF NOT EXISTS document_embeddings (
  document_id   TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  embedding     BLOB NOT NULL,
  dim           INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  computed_at   TEXT NOT NULL
);
