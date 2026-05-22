-- Materialized tag assignments for fast topic endpoints.
--
-- The public topic API still reports topics from documents.tags, but expanding
-- every JSON tag array on each request is too slow against the hosted libSQL
-- database. This table stores the max indexed set the topic routes need:
-- document, topic, and year period.

CREATE TABLE IF NOT EXISTS document_topic_assignments (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  period      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (document_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_document_topic_assignments_topic
  ON document_topic_assignments(topic);

CREATE INDEX IF NOT EXISTS idx_document_topic_assignments_topic_period
  ON document_topic_assignments(topic, period);

CREATE INDEX IF NOT EXISTS idx_document_topic_assignments_period_document
  ON document_topic_assignments(period, document_id);

INSERT OR IGNORE INTO document_topic_assignments (document_id, topic, period)
SELECT d.id,
       CAST(je.value AS TEXT) AS topic,
       CASE WHEN d.date <> '' THEN substr(d.date, 1, 4) ELSE '' END AS period
  FROM documents d,
       json_each(d.tags) je
 WHERE je.value IS NOT NULL
   AND CAST(je.value AS TEXT) <> '';

CREATE TRIGGER IF NOT EXISTS document_topic_assignments_documents_ai
AFTER INSERT ON documents
BEGIN
  INSERT OR IGNORE INTO document_topic_assignments (document_id, topic, period)
  SELECT new.id,
         CAST(je.value AS TEXT),
         CASE WHEN new.date <> '' THEN substr(new.date, 1, 4) ELSE '' END
    FROM json_each(new.tags) je
   WHERE je.value IS NOT NULL
     AND CAST(je.value AS TEXT) <> '';
END;

CREATE TRIGGER IF NOT EXISTS document_topic_assignments_documents_ad
AFTER DELETE ON documents
BEGIN
  DELETE FROM document_topic_assignments
   WHERE document_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS document_topic_assignments_documents_au
AFTER UPDATE OF tags, date ON documents
BEGIN
  DELETE FROM document_topic_assignments
   WHERE document_id = new.id;

  INSERT OR IGNORE INTO document_topic_assignments (document_id, topic, period)
  SELECT new.id,
         CAST(je.value AS TEXT),
         CASE WHEN new.date <> '' THEN substr(new.date, 1, 4) ELSE '' END
    FROM json_each(new.tags) je
   WHERE je.value IS NOT NULL
     AND CAST(je.value AS TEXT) <> '';
END;
