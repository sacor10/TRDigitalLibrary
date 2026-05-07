-- Per-field provenance tracking. Every scalar Document field gets one row in
-- document_field_provenance recording its origin URL, fetched-at timestamp, and
-- editor identity. Every change to a tracked field appends one row to
-- document_field_provenance_history with the prior JSON-encoded value, so the
-- audit trail is append-only.
--
-- The 'field' column stores the camelCase Document field name from
-- shared/src/schemas/document.ts (e.g. 'title', 'transcription', 'sourceUrl')
-- so a single key works across the API, schema, and DB layers.

CREATE TABLE IF NOT EXISTS document_field_provenance (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,
  source_url  TEXT,
  fetched_at  TEXT NOT NULL,
  editor      TEXT NOT NULL,
  PRIMARY KEY (document_id, field)
);

CREATE INDEX IF NOT EXISTS idx_field_provenance_doc
  ON document_field_provenance(document_id);

CREATE TABLE IF NOT EXISTS document_field_provenance_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id    TEXT NOT NULL,
  field          TEXT NOT NULL,
  previous_value TEXT,
  new_value      TEXT,
  source_url     TEXT,
  fetched_at     TEXT NOT NULL,
  editor         TEXT NOT NULL,
  recorded_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_field_provenance_history_doc
  ON document_field_provenance_history(document_id, field, recorded_at);
