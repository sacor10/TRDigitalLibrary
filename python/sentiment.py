#!/usr/bin/env python3
"""
VADER sentiment sidecar for the TR Digital Library.

Reads transcribed documents from `data/library.db`, scores each with
NLTK VADER (sentence-level, length-weighted compound aggregation), and
writes `document_sentiment` in a single transaction (DELETE-then-INSERT).
Mirrors the design of `python/topic_model.py`.

Invoked via `npm run sentiment` (which shells `scripts/run-sentiment.mjs`,
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
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "library.db"

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


def load_corpus(db_path: Path) -> list[dict[str, str]]:
    if not db_path.exists():
        raise SystemExit(
            f"[sentiment] Database not found at {db_path}. Run `npm run seed` first."
        )
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            SELECT id, transcription
              FROM documents
             WHERE length(trim(transcription)) > 0
             ORDER BY date ASC
            """
        ).fetchall()
    finally:
        con.close()
    return [{"id": r["id"], "transcription": r["transcription"]} for r in rows]


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
    db_path: Path,
    scored: list[tuple[str, float, float, float, float, str, int]],
) -> int:
    computed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    version = model_version()

    rows = [
        (doc_id, pol, pos, neu, neg, label, count, computed_at, version)
        for (doc_id, pol, pos, neu, neg, label, count) in scored
    ]

    con = sqlite3.connect(db_path)
    try:
        con.execute("PRAGMA foreign_keys = ON")
        with con:
            con.execute("DELETE FROM document_sentiment")
            con.executemany(
                """
                INSERT INTO document_sentiment
                  (document_id, polarity, pos, neu, neg, label, sentence_count,
                   computed_at, model_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
    finally:
        con.close()
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run VADER sentiment over the TR corpus.")
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help=f"Path to library.db (default: {DEFAULT_DB})",
    )
    args = parser.parse_args()

    docs = load_corpus(args.db)
    if not docs:
        print(
            "[sentiment] No transcribed documents found. "
            "Re-run `npm run seed` from a connected environment, then retry."
        )
        return 1

    print(f"[sentiment] loaded {len(docs)} transcribed document(s) from {args.db}")
    scored = fit_sentiment(docs)
    n = write_results(args.db, scored)
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
