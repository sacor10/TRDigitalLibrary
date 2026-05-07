CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  recipient TEXT,
  location TEXT,
  author TEXT NOT NULL DEFAULT 'Theodore Roosevelt',
  transcription TEXT NOT NULL,
  facsimile_url TEXT,
  provenance TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  tags TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(date);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_recipient ON documents(recipient);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  transcription,
  recipient,
  tags,
  content='documents',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, transcription, recipient, tags)
  VALUES (new.rowid, new.title, new.transcription, COALESCE(new.recipient, ''), new.tags);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, transcription, recipient, tags)
  VALUES ('delete', old.rowid, old.title, old.transcription, COALESCE(old.recipient, ''), old.tags);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, transcription, recipient, tags)
  VALUES ('delete', old.rowid, old.title, old.transcription, COALESCE(old.recipient, ''), old.tags);
  INSERT INTO documents_fts(rowid, title, transcription, recipient, tags)
  VALUES (new.rowid, new.title, new.transcription, COALESCE(new.recipient, ''), new.tags);
END;
