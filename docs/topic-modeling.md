# Topic Modeling (BERTopic) — Design

Status: design only — no implementation yet. Tracks the open Pillar 2 roadmap item in `README.md`.

## Goal

Cluster the corpus into **30–60 coherent themes** and **surface how each theme's prevalence drifts over time**. Surface both as a `/topics` page in the client.

## Why a separate design doc

BERTopic is a Python library; this monorepo is Node/TS + SQLite (`@tr/server`, `@tr/client`, `@tr/shared`). The implementation crosses a language boundary, adds a new toolchain, and touches schema/API/UI — bigger than any single PR should carry. This doc lets us land it in reviewable chunks (see "Phased delivery") and pins decisions before we start.

## Model choice

Real BERTopic via a Python sidecar — not a JS-native approximation.

- The roadmap line names BERTopic explicitly. A TF-IDF + k-means substitute doesn't satisfy "BERTopic" and produces noticeably weaker clusters on short historical letters.
- Embedding model: `sentence-transformers/all-MiniLM-L6-v2` (384-dim, CPU-friendly, free, MIT-licensed). Trade-off vs. `bge-small-en` documented later if quality is poor.
- Pipeline: BERTopic defaults — UMAP (`n_neighbors=15`, `n_components=5`, `min_dist=0`) → HDBSCAN (`min_cluster_size=10`) → c-TF-IDF.
- Reduce to target range with `topic_model.reduce_topics(nr_topics)`; aim for 30–60. If HDBSCAN produces fewer than 30, lower `min_cluster_size` and retry; if more than 60, reduce.

## Data model

New migration **`server/src/migrations/006_topics.sql`** following the style of `005_mentions.sql` (header comment explaining purpose; no destructive operations on existing tables).

```sql
CREATE TABLE IF NOT EXISTS topics (
  id            INTEGER PRIMARY KEY,
  label         TEXT    NOT NULL,            -- short human label, "Conservation & national parks"
  keywords      TEXT    NOT NULL DEFAULT '[]', -- JSON array of top c-TF-IDF terms
  size          INTEGER NOT NULL,            -- total documents assigned
  computed_at   TEXT    NOT NULL,            -- ISO 8601
  model_version TEXT    NOT NULL             -- git sha + sentence-transformers version
);

CREATE TABLE IF NOT EXISTS document_topics (
  document_id TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  topic_id    INTEGER NOT NULL REFERENCES topics(id)    ON DELETE CASCADE,
  probability REAL    NOT NULL,
  PRIMARY KEY (document_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_document_topics_topic ON document_topics(topic_id);

CREATE TABLE IF NOT EXISTS topic_drift (
  topic_id       INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  period         TEXT    NOT NULL,           -- 'YYYY' or 'YYYY-Qn'
  document_count INTEGER NOT NULL,
  share          REAL    NOT NULL,           -- count(period) / total_docs(period)
  PRIMARY KEY (topic_id, period)
);
```

`topic_drift` is precomputed by the sidecar so the client never recomputes shares on the fly. Bin granularity is configurable; default `year` (the only granularity Phase 4 ships).

## Shared schemas

New file **`shared/src/schemas/topic.ts`** following the Zod-first pattern in `shared/src/schemas/document.ts`. Export:

- `Topic` — `{id, label, keywords[], size, computedAt, modelVersion}`
- `TopicMember` — `{documentId, probability, title, date}` (joined for the detail endpoint)
- `TopicDriftPoint` — `{topicId, period, documentCount, share}`
- `TopicsResponse`, `TopicDetailResponse`, `TopicDriftResponse`

## Server endpoints

New router **`server/src/routes/topics.ts`** mounted in `server/src/app.ts` (mirrors `correspondents.ts`). All read-only.

| Method | Path                   | Returns                                                                                |
|--------|------------------------|----------------------------------------------------------------------------------------|
| GET    | `/api/topics`          | `Topic[]` ordered by `size DESC`                                                       |
| GET    | `/api/topics/:id`      | `Topic` + member documents (top N by probability, default 25, capped at 200)           |
| GET    | `/api/topics/drift`    | `TopicDriftPoint[]` for all topics; query param `?bin=year` (only `year` in Phase 4)   |

Tests live under `server/src/__tests__/topics.test.ts` with seeded fixture topics — same harness shape as the existing `documents.test.ts`.

## Client UI

New page **`client/src/pages/TopicsPage.tsx`** mounted at `/topics`, registered in `client/src/App.tsx` alongside `NetworkPage`.

Layout:

1. **Theme grid** (default view): one card per topic, ordered by size. Each card shows label, top 5 keyword chips, doc count, and a small sparkline of share-over-time pulled from `/api/topics/drift`. Clicking a card opens detail.
2. **Theme detail** (right pane or `/topics/:id`): keyword bar chart (top 15 by c-TF-IDF weight), drift line chart (full period series), and top-25 member documents linking to `/documents/:id`.

Charts: lightweight SVG hand-rolled (consistent with the no-charting-dependency choice elsewhere). Reuse the `IIIFFacsimilePane` styling conventions for panel chrome.

## Drift metric

For each topic `t` and period `p`:

```
share(t, p) = count(documents in t with date in p) / count(documents with date in p)
```

Stacked together, the shares for a period sum to ≤ 1 (HDBSCAN leaves some docs as noise, topic `-1`; we drop those from the drift table). "Surface drift" acceptance test: pick a topic seeded only with post-1900 letters, assert its share is 0 in pre-1900 bins and > 0 after — covered in `topics.test.ts`.

## Sidecar pipeline

New directory **`python/`** with:

- `python/topic_model.py` — entrypoint
- `python/requirements.txt` — `bertopic`, `sentence-transformers`, `numpy`, `scikit-learn`
- `python/README.md` — venv setup, single-command run

The script:

1. Opens `data/library.db` read-only via `sqlite3` stdlib.
2. Selects `id, date, transcription` from `documents` where `length(trim(transcription)) > 0`.
3. Embeds with `all-MiniLM-L6-v2`.
4. Fits BERTopic; reduces to ≤ 60 topics; iterates `min_cluster_size` if < 30.
5. Generates short labels via the BERTopic representation model (or top-3 keywords joined if no LLM available).
6. Opens a writable connection, runs all writes inside a single transaction:
   - `DELETE FROM topics; DELETE FROM document_topics; DELETE FROM topic_drift;`
   - Inserts new rows.
7. Stamps `model_version = "<git sha>:<sentence-transformers version>"`.

Orchestration: new root `package.json` script `topic-model` that shells `python python/topic_model.py`. Mirrors the existing graceful-skip pattern used by `npm run validate-tei` / `npm run validate-epub` (see `README.md` line 233): print a clear message and exit 0 if `python` is absent.

Runtime estimate: ~10 s on the 8-doc POC corpus; ~1–3 hr CPU on the full ~150k Morison target. Acceptable for an offline batch; if ever painful, switch embedding to GPU or run on a workstation and ship the resulting `.db` patch.

## Phased delivery

Each phase is a separate PR.

| Phase | Size | Deliverable                                                                          |
|-------|------|--------------------------------------------------------------------------------------|
| 1     | S    | Migration `006_topics.sql` + `shared/src/schemas/topic.ts`. No behavior change.       |
| 2     | M    | `python/topic_model.py` + `requirements.txt` + `npm run topic-model`. CLI only.       |
| 3     | M    | `server/src/routes/topics.ts` + tests. API live; still no UI.                        |
| 4     | M    | `client/src/pages/TopicsPage.tsx` + route. Feature visible end-to-end.                |
| 5     | S    | Tick the README box; add an "implemented with…" paragraph in the style of the network-graph item on `README.md` line 241. |

## Open questions

1. Drift granularity default: year (simpler, matches eventual 1858–1919 span) vs. quarter (resolves campaign cycles like 1912)? Plan calls year; quarter is a one-line config flip.
2. Topic recomputation cadence: on-demand (`npm run topic-model` after a corpus refresh) vs. nightly cron? Plan calls on-demand; we revisit if the corpus starts changing daily.
3. Label generation: top-3 c-TF-IDF terms joined ("conservation, parks, forest") vs. an LLM-generated short label. Plan calls keywords-only to keep the pipeline offline and cost-free; LLM labelling is a follow-up.
4. Should noise documents (BERTopic topic `-1`) be exposed somewhere, or hidden entirely? Plan hides them.

## Verification

After Phase 4 lands end-to-end:

- `npm run topic-model` populates 30–60 rows in `topics`, ~`count(transcribed docs)` rows in `document_topics`, and a row per (topic, year) in `topic_drift`.
- `curl localhost:3001/api/topics` returns the same count.
- `curl 'localhost:3001/api/topics/drift'` returns a series whose per-period shares sum to ≤ 1.
- `/topics` page renders the grid; clicking a card opens detail with a non-empty drift chart.
- `topics.test.ts` passes the post-1900-only drift assertion.
- The README checkbox flips to `[x]` and gains its "implemented with…" paragraph.
