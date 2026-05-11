# AGENTS.md

## Cursor Cloud specific instructions

### Overview

TR Digital Library is an npm workspaces monorepo with three packages: `@tr/shared` (Zod schemas), `@tr/server` (Express + libSQL API on :3001), and `@tr/client` (React + Vite SPA on :5173). The library and annotations DBs are libSQL — a hosted Turso instance in production, a local file (`data/library.db` / `data/annotations.db`) in dev. There is no Docker and no separate database server to run.

### Running the app

See the Quick Start in `README.md`. The essential commands are:

```
npm run ingest-loc -- --limit 25  # populates the local file:data/library.db
npm run dev                       # starts server (:3001) + client (:5173)
```

`npm run ingest` is the build-time orchestrator (`scripts/run-build-ingest.mjs`) — it is gated on `TURSO_LIBRARY_DATABASE_URL` being set, runs `ingest-loc` + `ingest-tei` idempotently, and only invokes the Python sidecars (`python/sentiment.py`, `python/topic_model.py`) when the ingest reports new or updated rows. A no-op rebuild therefore skips the heavy Python pass and finishes in seconds.

### Lint / Test / Build

```
npm run lint    # ESLint across all workspaces
npm run test    # Vitest: 122 server + 27 client tests
npm run build   # tsc --noEmit + vite build
```

### Environment variables (highlights)

- `TURSO_LIBRARY_DATABASE_URL` / `TURSO_LIBRARY_AUTH_TOKEN` — libSQL/Turso URL + token for the documents corpus. Defaults to `file:data/library.db` (no token required) in dev.
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — same shape for the annotations DB (`users`, `sessions`, `annotations`). Defaults to `file:data/annotations.db` in dev.
- `PIP_CACHE_DIR`, `HF_HOME`, `TRANSFORMERS_CACHE`, `SENTENCE_TRANSFORMERS_HOME` — set in `netlify.toml` to `/opt/build/cache/...` so `netlify-plugin-cache` persists Python wheels and HuggingFace weights between builds. The first analysis-triggering build downloads ~500 MB of sentence-transformers; subsequent builds reuse the cache.

### Non-obvious notes

- **ESLint**: `npm run lint` exits non-zero due to a single pre-existing `no-constant-condition` error in `server/src/sources/loc.ts`. This does not affect runtime or tests.
- **Client build TypeScript error**: Previously `npm run build` failed on the client workspace; this has been resolved. `npm run build` now succeeds across all three workspaces.
- **Ingest failures are partial-success-friendly**: Some Wikisource / LoC URLs return 404. The ingest scripts still insert all available documents with metadata; transcriptions are empty for failed fetches. This is by design.
- **Database location (dev)**: `data/library.db` and `data/annotations.db` are gitignored. Regenerate the library DB via `npm run ingest-loc -- --limit 25` after a fresh clone, or skip it entirely by exporting `TURSO_LIBRARY_DATABASE_URL` before running `npm run dev`.
- **Build-time analysis cost**: `npm run ingest` only invokes `python/sentiment.py` + `python/topic_model.py` when ingest reports `written + updated > 0`. The first such build is slow (~5–15 minutes cold) because BERTopic downloads `sentence-transformers/all-MiniLM-L6-v2`; the netlify-plugin-cache plumbing in `netlify.toml` keeps subsequent runs fast.
- **No `.env` required for dev**: All env vars have sensible defaults (`file:` URLs, dev-only `SESSION_SECRET` fallback). Production deploys MUST set the Turso URLs/tokens, `SESSION_SECRET`, and `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` before sign-in works.
