-- Tracks the inputs to the most recent topic-compute run so the server can
-- decide on boot whether the topics tables are still in sync with the
-- documents table. Written by the TS auto-bootstrap in
-- server/src/topics/compute.ts; the Python sidecar (legacy) does not write
-- here, so when the Python script runs the meta will lag and the next boot
-- will recompute on top of it -- that's the desired "code wins, but Python
-- output survives until the next code-driven recompute" behaviour.
--
-- The CHECK enforces a singleton row so callers can `UPDATE ... WHERE id = 1`
-- unconditionally without an INSERT/UPDATE race.
CREATE TABLE IF NOT EXISTS topic_compute_meta (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  document_count INTEGER NOT NULL,
  computed_at    TEXT    NOT NULL,
  model_version  TEXT    NOT NULL
);
