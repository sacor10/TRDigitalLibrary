-- Topic-modeling output tables. Populated offline by the BERTopic sidecar
-- (python/topic_model.py, see docs/topic-modeling.md). All writes happen in a
-- single transaction that DELETEs and re-INSERTs every row, so these tables
-- are always a snapshot of the most recent run.
--
-- `topics.keywords` is a JSON array string mirroring the `tags` / `mentions`
-- convention from 001_init.sql and 005_mentions.sql; deserialised at the API
-- boundary.

CREATE TABLE IF NOT EXISTS topics (
  id            INTEGER PRIMARY KEY,
  label         TEXT    NOT NULL,
  keywords      TEXT    NOT NULL DEFAULT '[]',
  size          INTEGER NOT NULL,
  computed_at   TEXT    NOT NULL,
  model_version TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS document_topics (
  document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  topic_id    INTEGER NOT NULL REFERENCES topics(id)    ON DELETE CASCADE,
  probability REAL    NOT NULL,
  PRIMARY KEY (document_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_document_topics_topic
  ON document_topics(topic_id);

CREATE TABLE IF NOT EXISTS topic_drift (
  topic_id       INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  period         TEXT    NOT NULL,
  document_count INTEGER NOT NULL,
  share          REAL    NOT NULL,
  PRIMARY KEY (topic_id, period)
);
