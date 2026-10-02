-- Bounded-text chunk index for cheap snippet generation.
--
-- FTS5 snippet() is O(column size): it re-scans the matched column's text to
-- locate the highlight window. The `transcription` column holds full-book-length
-- text (up to ~2.3 MB for LoC manuscripts), so snippet() over documents_fts cost
-- hundreds of ms per page and up to ~18 s for common terms. Matching/ranking
-- (bm25) is unaffected and stays on documents_fts; only snippets move here.
--
-- Chunks are populated in application code (db.ts upsert + backfill script), not
-- by a documents trigger, because splitting multi-MB text into ~2 KB windows is
-- impractical in SQL. The triggers below only keep the FTS index in sync with
-- whatever rows the application writes into document_chunks.

CREATE TABLE IF NOT EXISTS document_chunks (
  document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  PRIMARY KEY (document_id, chunk_index)
);

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  text,
  content='document_chunks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS document_chunks_ai AFTER INSERT ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS document_chunks_ad AFTER DELETE ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(document_chunks_fts, rowid, text)
  VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS document_chunks_au AFTER UPDATE ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(document_chunks_fts, rowid, text)
  VALUES ('delete', old.rowid, old.text);
  INSERT INTO document_chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
