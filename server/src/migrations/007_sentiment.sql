-- Per-document sentiment scores. Populated offline by the VADER sidecar
-- (python/sentiment.py, see README sentiment-analysis entry). All writes
-- happen in a single transaction that DELETEs and re-INSERTs every row,
-- so this table is always a snapshot of the most recent run.
--
-- `polarity` is VADER's compound score in [-1, 1]; pos/neu/neg sum to 1.0
-- per document. `label` is derived at write time using VADER's standard
-- thresholds (>= 0.05 positive, <= -0.05 negative, else neutral).

CREATE TABLE IF NOT EXISTS document_sentiment (
  document_id    TEXT    PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  polarity       REAL    NOT NULL,
  pos            REAL    NOT NULL,
  neu            REAL    NOT NULL,
  neg            REAL    NOT NULL,
  label          TEXT    NOT NULL CHECK (label IN ('positive', 'neutral', 'negative')),
  sentence_count INTEGER NOT NULL,
  computed_at    TEXT    NOT NULL,
  model_version  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_sentiment_polarity
  ON document_sentiment(polarity);
