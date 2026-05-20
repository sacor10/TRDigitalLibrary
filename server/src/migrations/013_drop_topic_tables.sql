-- Topics are now aggregated on-the-fly from documents.tags (Library of
-- Congress subject headings) rather than computed by the BERTopic sidecar.
-- The pre-computed tables are no longer read by anything.
DROP TABLE IF EXISTS topic_compute_meta;
DROP TABLE IF EXISTS topic_drift;
DROP TABLE IF EXISTS document_topics;
DROP TABLE IF EXISTS topics;
