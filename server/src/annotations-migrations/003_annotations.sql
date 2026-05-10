CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  section_id TEXT,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  motivation TEXT NOT NULL,
  body_text TEXT,
  selector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_annotations_doc ON annotations(document_id, created_at);
CREATE INDEX IF NOT EXISTS idx_annotations_creator ON annotations(creator_id);
