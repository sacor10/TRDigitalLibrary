#!/usr/bin/env python3
"""
BERTopic sidecar for the TR Digital Library.

Reads transcribed documents from `data/library.db`, fits BERTopic over
sentence-transformer embeddings, reduces to <= 60 topics, and writes
topics, document_topics, and topic_drift in a single transaction
(DELETE-then-INSERT). See docs/topic-modeling.md for design.

Invoked via `npm run topic-model` (which shells `scripts/run-topic-model.mjs`,
which finds Python and invokes this script). Direct invocation:

    python python/topic_model.py [--db PATH] [--bin year]

Acceptance per the README roadmap: cluster the corpus into 30-60 themes
and surface drift over time. On the 8-document POC corpus BERTopic will
produce <= 1 cluster — that is expected; meaningful clusters require the
full Morison corpus.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "library.db"

TARGET_MIN = 30
TARGET_MAX = 60


def git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip() or "unknown"
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def model_version() -> str:
    try:
        import sentence_transformers  # type: ignore[import-not-found]

        st_version = sentence_transformers.__version__
    except Exception:
        st_version = "unknown"
    return f"{git_sha()}:sentence-transformers=={st_version}"


def load_corpus(db_path: Path) -> list[dict[str, str]]:
    if not db_path.exists():
        raise SystemExit(
            f"[topic-model] Database not found at {db_path}. Run `npm run ingest-loc -- --limit 25` first."
        )
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            SELECT id, date, transcription
              FROM documents
             WHERE length(trim(transcription)) > 0
             ORDER BY date ASC
            """
        ).fetchall()
    finally:
        con.close()
    return [
        {"id": r["id"], "date": r["date"], "transcription": r["transcription"]}
        for r in rows
    ]


def year_of(iso_date: str) -> str | None:
    if not iso_date or len(iso_date) < 4:
        return None
    year = iso_date[:4]
    if not year.isdigit():
        return None
    return year


def short_label(keywords: list[str]) -> str:
    head = [k for k in keywords[:3] if k]
    return ", ".join(head) if head else "Unlabeled"


def fit_topics(docs: list[dict[str, str]]) -> tuple[list[int], list[float], dict[int, list[str]]]:
    """Return (assignments, probabilities, keywords_by_topic).

    assignments[i] is the topic id assigned to docs[i] (-1 = noise).
    probabilities[i] is the per-document probability returned by BERTopic
    for that assignment (1.0 if not available).
    keywords_by_topic maps topic_id -> top keyword strings (highest c-TF-IDF first).
    """
    try:
        from bertopic import BERTopic  # type: ignore[import-not-found]
        from sentence_transformers import SentenceTransformer  # type: ignore[import-not-found]
    except ImportError as err:
        raise SystemExit(
            "[topic-model] Missing Python dependency: "
            f"{err.name or err}. Install requirements first: "
            "pip install -r python/requirements.txt"
        ) from err

    texts = [d["transcription"] for d in docs]
    print(
        f"[topic-model] embedding {len(texts)} document(s) with "
        "sentence-transformers/all-MiniLM-L6-v2"
    )
    embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    embeddings = embedder.encode(texts, show_progress_bar=False)

    min_cluster = 10
    if len(texts) < min_cluster:
        # HDBSCAN cannot form clusters smaller than min_cluster_size; on the
        # POC corpus the result will be a single noise cluster. Drop the floor
        # so we at least exercise the pipeline end to end.
        min_cluster = max(2, len(texts) // 2)
        print(
            f"[topic-model] corpus has {len(texts)} docs (< 10); "
            f"lowering min_cluster_size to {min_cluster} for POC run"
        )

    print("[topic-model] fitting BERTopic (UMAP -> HDBSCAN -> c-TF-IDF)")
    model = BERTopic(
        embedding_model=embedder,
        min_topic_size=min_cluster,
        calculate_probabilities=False,
        verbose=False,
    )
    assignments, probs = model.fit_transform(texts, embeddings)

    distinct = sorted({a for a in assignments if a != -1})
    if len(distinct) > TARGET_MAX:
        print(f"[topic-model] reducing {len(distinct)} -> {TARGET_MAX} topics")
        model.reduce_topics(texts, nr_topics=TARGET_MAX)
        assignments = list(model.topics_)
        if model.probabilities_ is not None:
            probs = list(model.probabilities_)

    distinct = sorted({a for a in assignments if a != -1})
    if len(distinct) < TARGET_MIN and len(texts) >= TARGET_MIN * min_cluster:
        # Only retry on a corpus large enough to plausibly hit the target.
        retry_min = max(2, min_cluster // 2)
        print(
            f"[topic-model] only {len(distinct)} topic(s) found; "
            f"retrying with min_cluster_size={retry_min}"
        )
        model = BERTopic(
            embedding_model=embedder,
            min_topic_size=retry_min,
            calculate_probabilities=False,
            verbose=False,
        )
        assignments, probs = model.fit_transform(texts, embeddings)

    keywords_by_topic: dict[int, list[str]] = {}
    for tid in {a for a in assignments if a != -1}:
        words = model.get_topic(tid) or []
        keywords_by_topic[tid] = [w for w, _score in words][:15]

    if probs is None:
        probs = [1.0] * len(assignments)
    else:
        probs = [float(p) if p is not None else 1.0 for p in probs]

    return list(assignments), probs, keywords_by_topic


def write_results(
    db_path: Path,
    docs: list[dict[str, str]],
    assignments: list[int],
    probabilities: list[float],
    keywords_by_topic: dict[int, list[str]],
) -> tuple[int, int, int]:
    """Persist results in a single transaction. Returns (n_topics, n_doc_topics, n_drift)."""
    computed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    version = model_version()

    counts = Counter(a for a in assignments if a != -1)
    sorted_topics = sorted(counts.keys(), key=lambda t: (-counts[t], t))
    # Re-id topics as 0..N-1 ordered by descending size for stable PKs.
    remap = {old: new for new, old in enumerate(sorted_topics)}

    rows_topics: list[tuple[int, str, str, int, str, str]] = []
    for old_id, new_id in remap.items():
        kw = keywords_by_topic.get(old_id, [])
        rows_topics.append(
            (
                new_id,
                short_label(kw),
                json.dumps(kw),
                counts[old_id],
                computed_at,
                version,
            )
        )

    rows_doc_topics: list[tuple[str, int, float]] = []
    docs_per_period_per_topic: dict[tuple[int, str], int] = defaultdict(int)
    docs_per_period_total: dict[str, int] = defaultdict(int)

    for doc, assign, prob in zip(docs, assignments, probabilities):
        if assign == -1:
            continue
        new_id = remap[assign]
        rows_doc_topics.append((doc["id"], new_id, max(0.0, min(1.0, float(prob)))))
        period = year_of(doc["date"])
        if period is not None:
            docs_per_period_per_topic[(new_id, period)] += 1
            docs_per_period_total[period] += 1

    rows_drift: list[tuple[int, str, int, float]] = []
    for (new_id, period), count in docs_per_period_per_topic.items():
        total = docs_per_period_total[period]
        share = count / total if total else 0.0
        rows_drift.append((new_id, period, count, share))

    con = sqlite3.connect(db_path)
    try:
        con.execute("PRAGMA foreign_keys = ON")
        with con:
            con.execute("DELETE FROM topic_drift")
            con.execute("DELETE FROM document_topics")
            con.execute("DELETE FROM topics")
            con.executemany(
                "INSERT INTO topics (id, label, keywords, size, computed_at, model_version) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                rows_topics,
            )
            con.executemany(
                "INSERT INTO document_topics (document_id, topic_id, probability) "
                "VALUES (?, ?, ?)",
                rows_doc_topics,
            )
            con.executemany(
                "INSERT INTO topic_drift (topic_id, period, document_count, share) "
                "VALUES (?, ?, ?, ?)",
                rows_drift,
            )
    finally:
        con.close()

    return len(rows_topics), len(rows_doc_topics), len(rows_drift)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run BERTopic over the TR corpus.")
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help=f"Path to library.db (default: {DEFAULT_DB})",
    )
    parser.add_argument(
        "--bin",
        choices=["year"],
        default="year",
        help="Drift-binning granularity (only 'year' supported in Phase 4).",
    )
    args = parser.parse_args()

    docs = load_corpus(args.db)
    if not docs:
        print(
            "[topic-model] No transcribed documents found. "
            "Run `npm run ingest-loc -- --limit 25` from a connected environment, then retry."
        )
        return 1

    print(f"[topic-model] loaded {len(docs)} transcribed document(s) from {args.db}")
    assignments, probs, keywords = fit_topics(docs)
    n_topics, n_dt, n_drift = write_results(args.db, docs, assignments, probs, keywords)
    n_noise = sum(1 for a in assignments if a == -1)
    print(
        f"[topic-model] wrote {n_topics} topic(s), "
        f"{n_dt} document_topics row(s), {n_drift} drift row(s) "
        f"({n_noise} doc(s) classified as noise)"
    )
    if n_topics < TARGET_MIN:
        print(
            f"[topic-model] note: only {n_topics} topic(s); the README acceptance "
            f"target of {TARGET_MIN}-{TARGET_MAX} themes assumes the full ~150k "
            "Morison corpus, not the 8-document POC."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
