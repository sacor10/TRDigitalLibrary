# Topic-modeling sidecar

Offline batch job that clusters the corpus into themes via [BERTopic](https://maartengr.github.io/BERTopic/), writing results to the `topics`, `document_topics`, and `topic_drift` tables in `data/library.db`. Design: [`docs/topic-modeling.md`](../docs/topic-modeling.md).

The sidecar is Python because BERTopic and `sentence-transformers` have no production-quality JS port. Everything else in the repo (server, client, schemas) stays Node/TS — the boundary is a single SQLite file.

## Setup

Requires Python 3.10+.

```bash
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# Bash:                source .venv/bin/activate
pip install -r python/requirements.txt
```

The first run downloads `sentence-transformers/all-MiniLM-L6-v2` (~90 MB) into the local Hugging Face cache.

## Run

From the repo root:

```bash
npm run topic-model           # via the Node wrapper (graceful skip if Python is absent)
python python/topic_model.py  # direct invocation
python python/topic_model.py --db ./data/library.db
```

The script:

1. Opens `data/library.db` read-only.
2. Selects every document with a non-empty `transcription`.
3. Embeds with `all-MiniLM-L6-v2` (384-dim, MIT-licensed, CPU-friendly).
4. Fits BERTopic (UMAP -> HDBSCAN -> c-TF-IDF), reduces to <= 60 topics, retries with a smaller `min_cluster_size` if fewer than 30 emerge *and* the corpus is large enough to plausibly hit that target.
5. Re-IDs topics 0..N-1 sorted by descending size.
6. Re-opens the DB writable and writes all rows in a single transaction (DELETEs first, then INSERTs).

`model_version` is stamped as `<git short sha>:sentence-transformers==<version>`.

## Expected runtime

| Corpus | Docs | Wall time (CPU) |
|--------|------|-----------------|
| POC (current `npm run seed`) | 8 | ~10 s |
| Full Morison/Blum letters | ~150,000 | 1–3 hr |

GPU embedding gets the latter under 15 min if it ever matters.

## POC corpus caveat

BERTopic's HDBSCAN backend will not form clusters smaller than `min_cluster_size=10`. The seeded POC corpus has 8 documents — the script automatically lowers the threshold so the pipeline runs end to end, but expect **<= 1 real topic** on this corpus. The README acceptance target of 30–60 themes assumes the full ~150k Morison corpus.

## Verification

After a run:

```bash
sqlite3 data/library.db "SELECT id, label, size FROM topics ORDER BY size DESC"
sqlite3 data/library.db "SELECT topic_id, period, document_count, share FROM topic_drift ORDER BY period, topic_id"
curl http://localhost:3001/api/topics
```

The drift acceptance check (per `docs/topic-modeling.md`): a topic populated only with post-1900 letters has `share = 0` for every pre-1900 period. The integration test `server/src/__tests__/topics.test.ts` verifies this with seeded fixtures so it passes regardless of the live corpus.
