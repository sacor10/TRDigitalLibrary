CREATE INDEX IF NOT EXISTS idx_documents_type_date
  ON documents(type, date);

CREATE INDEX IF NOT EXISTS idx_documents_title
  ON documents(title);

