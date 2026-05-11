-- Normalized correspondent network metadata sourced from the Theodore
-- Roosevelt Center Digital Library. This is intentionally metadata-only:
-- source URLs and citation fields are stored, but no TRC images or full text
-- are copied.

CREATE TABLE IF NOT EXISTS correspondents (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  sort_label TEXT NOT NULL,
  trc_slug   TEXT,
  trc_url    TEXT,
  is_tr      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_correspondents_trc_slug_unique
  ON correspondents(trc_slug)
  WHERE trc_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_correspondents_sort_label
  ON correspondents(sort_label);

CREATE TABLE IF NOT EXISTS correspondence_items (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  date              TEXT,
  date_display      TEXT,
  resource_type     TEXT NOT NULL,
  collection        TEXT,
  repository        TEXT,
  language          TEXT,
  period            TEXT,
  page_count        TEXT,
  production_method TEXT,
  record_type       TEXT,
  rights            TEXT,
  fetched_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (resource_type IN ('letter', 'telegram'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_correspondence_items_source_url_unique
  ON correspondence_items(source_url);

CREATE INDEX IF NOT EXISTS idx_correspondence_items_date
  ON correspondence_items(date);

CREATE INDEX IF NOT EXISTS idx_correspondence_items_resource_type
  ON correspondence_items(resource_type);

CREATE TABLE IF NOT EXISTS correspondence_participants (
  item_id          TEXT NOT NULL REFERENCES correspondence_items(id) ON DELETE CASCADE,
  correspondent_id TEXT NOT NULL REFERENCES correspondents(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  raw_name         TEXT NOT NULL,
  authority_slug   TEXT,
  authority_url    TEXT,
  ordinal          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, role, ordinal),
  CHECK (role IN ('creator', 'recipient'))
);

CREATE INDEX IF NOT EXISTS idx_correspondence_participants_correspondent
  ON correspondence_participants(correspondent_id, role);

CREATE INDEX IF NOT EXISTS idx_correspondence_participants_item
  ON correspondence_participants(item_id);
