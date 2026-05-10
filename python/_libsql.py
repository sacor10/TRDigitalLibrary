"""
Shared libsql_client helpers for the Python sidecars.

Connection precedence (mirrors server/src/db.ts):
  1. explicit url=/auth_token= passed in
  2. TURSO_LIBRARY_DATABASE_URL + TURSO_LIBRARY_AUTH_TOKEN
  3. local file at ``data/library.db`` (relative to repo root)

The Python libsql-client package speaks the same wire protocol as the
TypeScript ``@libsql/client`` package, so the schema applied by the
TypeScript migration runner (``server/src/migrations/``) is what we
target here. We do not run migrations from Python.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOCAL_DB = REPO_ROOT / "data" / "library.db"


def resolve_url(cli_db: Path | None) -> str:
    """Return the libsql URL to use for this run.

    ``cli_db`` mirrors the legacy ``--db PATH`` flag; when set, it wins so
    developers can keep pointing the sidecars at a specific local file.
    """
    if cli_db is not None:
        return f"file:{cli_db}"
    env_url = os.environ.get("TURSO_LIBRARY_DATABASE_URL")
    if env_url:
        return env_url
    return f"file:{DEFAULT_LOCAL_DB}"


def resolve_auth_token() -> str | None:
    return os.environ.get("TURSO_LIBRARY_AUTH_TOKEN")


def is_file_url(url: str) -> bool:
    return url.startswith("file:")


def file_path_from_url(url: str) -> Path | None:
    """Return the OS path encoded in a ``file:`` URL, or ``None`` for remote."""
    if not is_file_url(url):
        return None
    raw = url[len("file:") :]
    # ``file://abs`` is also valid; strip the leading // if present.
    if raw.startswith("//"):
        raw = raw[2:]
    return Path(raw)


def open_client(cli_db: Path | None):
    """Open a libsql client. Caller is responsible for closing it."""
    try:
        import libsql_client  # type: ignore[import-not-found]
    except ImportError as err:
        raise SystemExit(
            "[libsql] Missing Python dependency: libsql-client. "
            "Install requirements first: pip install -r python/requirements.txt"
        ) from err

    url = resolve_url(cli_db)
    auth_token = resolve_auth_token()

    if is_file_url(url):
        path = file_path_from_url(url)
        if path is not None and not path.exists():
            raise SystemExit(
                f"[libsql] Database not found at {path}. "
                "Run `npm run ingest-loc -- --limit 25` first, "
                "or set TURSO_LIBRARY_DATABASE_URL to a hosted libSQL URL."
            )

    return libsql_client.create_client_sync(url=url, auth_token=auth_token)


def execute_many(client, sql: str, rows: Sequence[Sequence]) -> None:
    """Run ``sql`` once per row in ``rows`` inside a single libsql batch.

    libsql-client doesn't expose a Python ``executemany``; the wire-level
    ``batch`` is the equivalent and runs the statements as one transaction
    with non-interactive semantics.
    """
    if not rows:
        return
    client.batch([(sql, list(args)) for args in rows])


def batch_statements(client, statements: Iterable) -> None:
    """Convenience wrapper: pass a mixed iterable of SQL strings or
    ``(sql, args)`` tuples to ``client.batch`` as one atomic transaction.
    """
    client.batch(list(statements))
