-- Add TEI/XML support: raw TEI on documents, structural sections table, FTS5 mirror.

-- The migration runner wraps each statement in a guarded exec, so re-running this
-- file after the first apply is safe even though SQLite has no IF NOT EXISTS for
-- ALTER TABLE ADD COLUMN.
ALTER TABLE documents ADD COLUMN tei_xml TEXT;

CREATE TABLE IF NOT EXISTS document_sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES document_sections(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  level INTEGER NOT NULL,
  type TEXT NOT NULL,
  n TEXT,
  heading TEXT,
  text TEXT NOT NULL DEFAULT '',
  xml_fragment TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sections_document ON document_sections(document_id, "order");
CREATE INDEX IF NOT EXISTS idx_sections_parent ON document_sections(parent_id);

CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  heading,
  text,
  content='document_sections',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS sections_ai AFTER INSERT ON document_sections BEGIN
  INSERT INTO sections_fts(rowid, heading, text)
  VALUES (new.rowid, COALESCE(new.heading, ''), new.text);
END;

CREATE TRIGGER IF NOT EXISTS sections_ad AFTER DELETE ON document_sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, heading, text)
  VALUES ('delete', old.rowid, COALESCE(old.heading, ''), old.text);
END;

CREATE TRIGGER IF NOT EXISTS sections_au AFTER UPDATE ON document_sections BEGIN
  INSERT INTO sections_fts(sections_fts, rowid, heading, text)
  VALUES ('delete', old.rowid, COALESCE(old.heading, ''), old.text);
  INSERT INTO sections_fts(rowid, heading, text)
  VALUES (new.rowid, COALESCE(new.heading, ''), new.text);
END;
