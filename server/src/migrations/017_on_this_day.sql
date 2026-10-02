-- Expression index on the month-day slice of documents.date so the
-- "On this day" homepage widget (WHERE substr(date, 6, 5) = ?) stays cheap at
-- full-corpus scale. The query must use the same substr(date, 6, 5) expression
-- for SQLite to use this index.
CREATE INDEX IF NOT EXISTS idx_documents_monthday
  ON documents(substr(date, 6, 5));
