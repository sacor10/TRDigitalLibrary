#!/usr/bin/env python3
"""
VADER sentiment sidecar for the TR Digital Library.

Reads transcribed documents from the configured library DB (Turso in
production, ``data/library.db`` locally), scores each with NLTK VADER
(sentence-level, length-weighted compound aggregation), and writes
``document_sentiment`` in a single transaction (DELETE-then-INSERT).
Mirrors the design of ``python/topic_model.py``.

Connection precedence (see ``python/_libsql.py``):
  1. ``--db PATH`` (legacy local file flag)
  2. ``TURSO_LIBRARY_DATABASE_URL`` + ``TURSO_LIBRARY_AUTH_TOKEN``
  3. ``file:./data/library.db`` (local-dev fallback)

Invoked via ``npm run sentiment`` (which shells ``scripts/run-sentiment.mjs``,
which finds Python and invokes this script). Direct invocation:

    python python/sentiment.py [--db PATH]

Acceptance per the README roadmap: per-document polarity score and a
"TR's mood across the 1912 campaign" demo chart. The 1912 demo will be
empty on the 8-document POC corpus (1899-1910) — meaningful coverage
requires the full ~150k Morison corpus.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from _libsql import REPO_ROOT, batch_statements, open_client, resolve_url

POSITIVE_THRESHOLD = 0.05
NEGATIVE_THRESHOLD = -0.05

# Pragmatic sentence splitter used as a fallback when NLTK punkt is unavailable.
# VADER is robust to imperfect splits — losing a fragment is preferable to
# requiring an extra punkt download on first run.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'\(])|\n{2,}")


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
        import vaderSentiment  # type: ignore[import-not-found]

        vader_version = getattr(vaderSentiment, "__version__", "unknown")
    except Exception:
        vader_version = "unknown"
    return f"{git_sha()}:vader=={vader_version}"


def load_corpus(client) -> list[dict[str, str]]:
    rs = client.execute(
        """
        SELECT id, transcription
          FROM documents
         WHERE length(trim(transcription)) > 0
         ORDER BY date ASC
        """
    )
    out: list[dict[str, str]] = []
    for row in rs.rows:
        out.append({"id": str(row["id"]), "transcription": str(row["transcription"])})
    return out


def split_sentences(text: str) -> list[str]:
    cleaned = text.strip()
    if not cleaned:
        return []
    parts = _SENTENCE_SPLIT.split(cleaned)
    return [p.strip() for p in parts if p and p.strip()]


def score_document(analyzer, text: str) -> dict[str, float | int]:
    sentences = split_sentences(text)
    if not sentences:
        return {
            "polarity": 0.0,
            "pos": 0.0,
            "neu": 1.0,
            "neg": 0.0,
            "sentence_count": 0,
        }
    total_chars = 0
    weighted = {"compound": 0.0, "pos": 0.0, "neu": 0.0, "neg": 0.0}
    for sent in sentences:
        scores = analyzer.polarity_scores(sent)
        weight = max(1, len(sent))
        total_chars += weight
        for key in weighted:
            weighted[key] += scores[key] * weight
    return {
        "polarity": weighted["compound"] / total_chars,
        "pos": weighted["pos"] / total_chars,
        "neu": weighted["neu"] / total_chars,
        "neg": weighted["neg"] / total_chars,
        "sentence_count": len(sentences),
    }


def label_for(polarity: float) -> str:
    if polarity >= POSITIVE_THRESHOLD:
        return "positive"
    if polarity <= NEGATIVE_THRESHOLD:
        return "negative"
    return "neutral"


def fit_sentiment(docs: list[dict[str, str]]) -> list[tuple[str, float, float, float, float, str, int]]:
    try:
        from vaderSentiment.vaderSentiment import (  # type: ignore[import-not-found]
            SentimentIntensityAnalyzer,
        )
    except ImportError as err:
        raise SystemExit(
            "[sentiment] Missing Python dependency: "
            f"{err.name or err}. Install requirements first: "
            "pip install -r python/requirements.txt"
        ) from err

    analyzer = SentimentIntensityAnalyzer()
    print(f"[sentiment] scoring {len(docs)} document(s) with VADER")
    rows: list[tuple[str, float, float, float, float, str, int]] = []
    for doc in docs:
        s = score_document(analyzer, doc["transcription"])
        polarity = float(s["polarity"])
        rows.append(
            (
                doc["id"],
                polarity,
                float(s["pos"]),
                float(s["neu"]),
                float(s["neg"]),
                label_for(polarity),
                int(s["sentence_count"]),
            )
        )
    return rows


def write_results(
    client,
    scored: list[tuple[str, float, float, float, float, str, int]],
) -> int:
    computed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    version = model_version()

    insert_sql = (
        "INSERT INTO document_sentiment "
        "  (document_id, polarity, pos, neu, neg, label, sentence_count, "
        "   computed_at, model_version) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )

    statements: list = ["DELETE FROM document_sentiment"]
    for (doc_id, pol, pos, neu, neg, label, count) in scored:
        statements.append(
            (insert_sql, [doc_id, pol, pos, neu, neg, label, count, computed_at, version])
        )

    # ``client.batch`` runs the whole list as one atomic transaction, which
    # is the libsql equivalent of ``with con: con.executemany(...)``.
    batch_statements(client, statements)
    return len(scored)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run VADER sentiment over the TR corpus.")
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help=(
            "Path to a local SQLite library DB (default: TURSO_LIBRARY_DATABASE_URL "
            "or file:./data/library.db)"
        ),
    )
    args = parser.parse_args()

    print(f"[sentiment] connecting to {resolve_url(args.db)}")
    with open_client(args.db) as client:
        docs = load_corpus(client)
        if not docs:
            print(
                "[sentiment] No transcribed documents found. "
                "Run `npm run ingest` (or the underlying ingest-loc / ingest-tei) "
                "from a connected environment, then retry."
            )
            return 1

        print(f"[sentiment] loaded {len(docs)} transcribed document(s)")
        scored = fit_sentiment(docs)
        n = write_results(client, scored)

    pos = sum(1 for r in scored if r[5] == "positive")
    neu = sum(1 for r in scored if r[5] == "neutral")
    neg = sum(1 for r in scored if r[5] == "negative")
    print(
        f"[sentiment] wrote {n} row(s): "
        f"{pos} positive, {neu} neutral, {neg} negative"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
