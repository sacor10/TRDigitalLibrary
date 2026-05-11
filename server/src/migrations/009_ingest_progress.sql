-- Resume cursor for chunked source ingests.
--
-- Each Netlify build caps the LoC ingest at INGEST_CHUNK_SIZE items so the
-- 18-minute build window cannot be exceeded. The CLI reads this table on
-- startup (when --start-page is not explicitly passed) to resume from the
-- next un-ingested page, and writes it after every successful collection
-- page so a mid-chunk timeout still preserves progress at page granularity.
-- One row per source ('loc', and any future source); completed=1 marks the
-- collection as fully ingested so subsequent builds early-exit cheaply.

CREATE TABLE IF NOT EXISTS ingest_progress (
  source     TEXT PRIMARY KEY,
  next_page  INTEGER,
  completed  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL
);
