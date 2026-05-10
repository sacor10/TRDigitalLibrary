# TR Digital Library

> A scholarly, accessible, open archive of Theodore Roosevelt's complete works and correspondence.

This is a working **proof-of-concept**: a typed monorepo that ingests public-domain TR
records and text from the Library of Congress, indexes them in libSQL/SQLite FTS5
(hosted on Turso in production, a local file in dev), exposes a documented REST API,
and renders a dual-pane (facsimile + transcription) reader with search, browse, and
timeline views.

The goal is not to ship every feature — it is to prove the architecture so that the
production build can extend it confidently.

---

## 1. Project overview

### Vision
Make Theodore Roosevelt's complete corpus — speeches, letters, diaries, articles,
autobiography — readable, searchable, citable, and **freely linkable** to the
canonical public-domain record. Combine the rigor of a scholarly edition with the
accessibility of a modern web app.

### Audience
- **Researchers and historians** — full-text search, provenance, citations, an
  OpenAPI-documented dataset they can mine, draft-vs-final diffing, scholarly
  annotations.
- **Educators and students** — a clean reader, contextual essays, a chronological
  timeline, citation export in three styles.
- **Curious enthusiasts** — a browseable, beautiful library that works on a
  phone, on a screen reader, in dark mode, offline-first where possible.

### Guiding principles
1. **Open access.** Code is MIT. Content is imported from public-domain
   sources and never re-bundled — the canonical URL is always one click away.
2. **Scholarly rigor.** Every document carries provenance, source attribution, a
   stable id, and the structured metadata needed to cite it. Annotations and
   corrections are first-class.
3. **Accessibility first.** Semantic HTML, keyboard-only flows, ARIA where it
   helps, dark mode, focus rings, color contrast — not an afterthought.
4. **Progressive scale.** SQLite + FTS5 today, Postgres + Meilisearch + IIIF
   tomorrow, with the same shared schemas.

---

## 2. Quick start

```bash
# 1. install (npm workspaces handles the three packages)
npm install

# 2. import a LoC pilot corpus into SQLite. Requires outbound HTTPS.
npm run ingest-loc -- --limit 25 --reset

# 3. start both server (:3001) and client (:5173) in watch mode
npm run dev

# tests
npm run test          # all workspaces
npm run test -w server
npm run test -w client

# production build (type-check + vite build)
npm run build
```

Open <http://localhost:5173> in a browser. The OpenAPI spec is at
<http://localhost:3001/api/openapi.json>.

> **Offline note:** the LoC importer needs network access to fetch metadata and
> full text. If a LoC item has no `fulltext_file`, it is still inserted with
> metadata and a `sourceUrl`; search will match its title, source fields, and tags.

> **Production note:** do not run ingestion from the live server process. The
> Netlify build runs an idempotent ingest against the configured Turso DB
> (`npm run ingest`) before `npm run build`; a rebuild with no new content
> finishes in seconds and skips the Python analysis pass entirely. See the
> [Build-time ingest + analysis](#build-time-ingest--analysis) section below.

### Ingesting Library of Congress documents

Import source-item records from the Library of Congress Theodore Roosevelt Papers:

```bash
npm run ingest-loc -- --limit 25          # quick local pilot
npm run ingest-loc -- --limit 25 --reset  # clear old corpus rows first
npm run ingest-loc -- --start-page 4      # resume a larger import by LoC page
npm run ingest-loc -- --dry-run           # fetch and map, but do not write
npm run ingest-loc -- --db ./data/library.db
```

The importer pages through the official loc.gov JSON API for records with
`online text`, fetches each item record, pulls `resources[].fulltext_file`, maps
the metadata into the existing `documents` table, and lets the current SQLite
FTS5 triggers update search indexes automatically. V1 stores one row per LoC
source item; page-level text can be added later through `document_sections`.

### Ingesting TEI documents

Validate and ingest a folder of TEI/XML documents into the library:

```bash
npm run ingest-tei -- /path/to/tei-folder            # validate, normalize, insert
npm run ingest-tei -- /path/to/tei-folder --dry-run  # parse + validate only
npm run ingest-tei -- /path/to/tei-folder -r         # recurse into subfolders
npm run ingest-tei -- /path/to/tei-folder --db ./data/library.db
```

Each `.xml` file is checked for well-formedness and required TEI structure
(`teiHeader`, `fileDesc`, `titleStmt/title`, `publicationStmt`, `sourceDesc`,
`text/body`). Valid documents are upserted into `documents` (with the original
TEI preserved in `tei_xml`) and their structural hierarchy — `div`, `p`, `lg`,
`l`, `quote`, `list`, `item`, `head`, `note` — is unrolled into
`document_sections` so each section is independently queryable and
FTS5-searchable. The CLI prints a per-file report and exits non-zero if any
file fails validation.

### Exporting documents

Every document is downloadable as PDF, EPUB, or TEI/XML directly from the API,
and from the **Export** panel in the document sidebar of the reader UI:

```bash
curl -OJ http://localhost:3001/api/documents/man-in-the-arena/export.pdf
curl -OJ http://localhost:3001/api/documents/man-in-the-arena/export.epub
curl -OJ http://localhost:3001/api/documents/man-in-the-arena/export.xml
```

To run the spec validators (CI-friendly; both skip if the tool is absent):

```bash
# Requires libxml2-utils (apt) or libxml2 (brew). Fetches tei_all.rng on first run.
npm run validate-tei -w server

# Requires epubcheck on PATH (`brew install epubcheck`) or
# EPUBCHECK_JAR=/path/to/epubcheck.jar with java on PATH.
npm run validate-epub -w server
```

---

## 3. Architecture

### Repo layout

```
TRDigitalLibrary/
├── data/
│   └── library.db           # local dev fallback DB (gitignored; Turso replaces it in prod)
├── shared/                  # zod schemas + inferred TS types (single source of truth)
│   └── src/
│       ├── schemas/document.ts
│       └── index.ts
├── server/                  # Express + @libsql/client (Turso/libSQL) + zod
│   └── src/
│       ├── app.ts           # Express bootstrap (helmet, cors, routes)
│       ├── db.ts            # libsql client, migration runner, upsert + replaceSections
│       ├── migrations/
│       │   ├── 001_init.sql # documents + documents_fts + triggers
│       │   └── 002_tei.sql  # tei_xml column, document_sections + sections_fts
│       ├── ingest-loc.ts    # CLI: npm run ingest-loc -- [options]
│       ├── ingest-tei.ts    # CLI: npm run ingest-tei -- <folder>
│       ├── upload-to-turso.ts # one-shot bootstrap from a local file:data/library.db
│       ├── sources/loc.ts   # LoC JSON API adapter + document mapper
│       ├── ingest/          # TEI parser, validator, transformer, orchestrator
│       ├── openapi.ts       # OpenAPI 3.1 generated from zod
│       ├── routes/
│       │   ├── documents.ts # GET /api/documents, GET /api/documents/:id
│       │   └── search.ts    # GET /api/search (FTS5 + bm25 + snippet)
│       └── __tests__/api.test.ts
└── client/                  # React 18 + Vite + Tailwind + React Query
    └── src/
        ├── api/client.ts            # typed fetch + zod response validation
        ├── context/ThemeContext.tsx
        ├── lib/citation.ts          # Chicago / MLA / APA generation
        ├── components/
        │   ├── Layout.tsx           # skip link, header, dark-mode toggle
        │   ├── DocumentViewer.tsx   # ARIA tablist (Transcription / Facsimile)
        │   ├── FacsimilePane.tsx    # react-zoom-pan-pinch
        │   ├── TranscriptionPane.tsx
        │   ├── MetadataSidebar.tsx
        │   ├── CitationGenerator.tsx
        │   ├── SearchBar.tsx        # debounced
        │   ├── SearchResults.tsx    # sanitized <mark> highlights
        │   ├── DocumentList.tsx
        │   └── Timeline.tsx         # SVG axis, multi-lane, keyboardable
        └── pages/
            ├── HomePage.tsx
            ├── BrowsePage.tsx
            ├── SearchPage.tsx
            ├── TimelinePage.tsx
            └── DocumentPage.tsx
```

### Data flow

```
              npm run ingest-loc
                      │
  LoC collection JSON ───────► item JSON ───────► fulltext_file
          │                         │                    │
          └─────────────────────────┴────────────────────▼
                                   upsert into SQLite + FTS5 trigger updates index
                                                          │
                                                          ▼
        ┌────────────────────────────────────────────────────────────┐
        │  Express API                                                │
        │  GET /api/documents       (filter+sort+paginate)            │
        │  GET /api/documents/:id   (single)                          │
        │  GET /api/search?q=…      (FTS5 MATCH + bm25 + snippet)     │
        │  GET /api/openapi.json    (3.1 spec generated from zod)     │
        └─────┬───────────────────────────────────────────────────────┘
              │ JSON validated against shared zod schemas on both sides
              ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  React + React Query                                        │
        │  /, /browse, /search, /timeline, /documents/:id             │
        └─────────────────────────────────────────────────────────────┘
```

### Stack rationale

| Layer       | POC choice                             | Why                                                                                                           |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Schemas     | Zod in `/shared`                       | Single source of truth; validates at both API boundaries; OpenAPI generated for free.                         |
| Server      | Express + @libsql/client (Turso/libSQL) | libSQL is wire-protocol-compatible with SQLite (FTS5 included) and lets dev (`file:`) and prod (Turso) share one driver. |
| Search      | SQLite FTS5 (`porter unicode61`, BM25) | Zero ops, real ranking, real snippets. Trivially upgradable to Meilisearch with the same shared schemas.      |
| API surface | OpenAPI 3.1 from Zod                   | Spec drives doc generation, client codegen, and contract testing.                                             |
| Client      | React 18 + Vite + Tailwind + RQ        | Fastest path to a polished, accessible reader. RQ memoizes `/search` and `/documents` calls for free.         |
| Tests       | Vitest + supertest                     | Same runner client and server. Supertest hits real Express; in-memory SQLite per test suite for hermeticism. |

### POC → production migration

| Concern             | POC                          | Production                                                       |
| ------------------- | ---------------------------- | ---------------------------------------------------------------- |
| RDBMS               | libSQL on Turso (sqlite-compat) | Postgres (pg / drizzle / kysely)                                 |
| Full-text search    | SQLite FTS5                  | Meilisearch (or Elasticsearch); same query API at the API layer  |
| Image hosting       | Remote LoC / Wikimedia URLs  | Internet Archive IIIF (`iiif.archive.org`) — $0 for public-domain; or serverless-iiif (AWS Lambda + S3) if dynamic transforms needed |
| Transcription store | Cached at import time        | TEI/XML primary store; HTML/plain text projections               |
| Auth                | none                         | OAuth (researcher accounts), JWT for API rate-limit tiers        |
| Deploy              | Local `npm run dev`          | Docker → Fly.io / Railway → AWS ECS as scale demands              |

---

## 4. Roadmap — five pillars

Legend: **S** = small (≤1 day) · **M** = medium (1–3 days) · **L** = large (1–2 weeks) · **XL** = epic (multi-sprint)

### Pillar 1 — Comprehensive Collection

- [x] **LoC source-item ingestion pipeline** — M — implemented with the official loc.gov JSON API. See `server/src/sources/loc.ts` and `npm run ingest-loc -- --limit 25`.
- [x] **TEI/XML ingestion pipeline** — XL — implemented with `fast-xml-parser` (pure Node, no Saxon/tei-publisher runtime required). See `server/src/ingest/` and `npm run ingest-tei -- <folder>`. Validates well-formedness and required TEI structure, preserves hierarchy in `document_sections`, retains raw TEI in `documents.tei_xml`.
- [x] **IIIF image server integration** — L — Internet Archive IIIF ($0, public-domain content only). Upload facsimiles to archive.org; endpoints auto-generated at `iiif.archive.org`; no server, no config, no egress cost; full IIIF Image API 3.0; no SLA or manifest control. Implemented as `iiifManifestUrl` (Presentation 3.0) on every document, parsed by `client/src/lib/iiif.ts`, rendered by `IIIFFacsimilePane` via OpenSeadragon for deep-zoom + multi-page navigation; legacy `facsimileUrl` retained as fallback.
- [ ] **OCR pipeline (Tesseract → Transkribus)** — XL — Tesseract free; Transkribus credits ~€0.05/page for handwriting. Acceptance: a typewritten page yields ≥98% character accuracy; a handwritten letter yields ≥90% via Transkribus.
- [x] **Provenance tracking** — M — implemented: every scalar field on every document carries `{sourceUrl, fetchedAt, editor}` recorded at import/ingest time in `document_field_provenance`, with an append-only `document_field_provenance_history` audit trail. Corrections go through `PATCH /api/documents/:id` (requires `X-Editor` header) until the auth pillar lands. Migration `004_provenance.sql`; schemas `FieldProvenance` / `DocumentPatch` in `shared/src/schemas/document.ts`; LoC/TEI editor defaults to `loc-ingest` / `tei-ingest` and is overridable via `--editor`.
- [x] **Multi-format exports (PDF / EPUB / TEI)** — L — implemented: per-document Export panel in the sidebar; server endpoints `GET /api/documents/:id/export.{pdf,epub,xml}` stream downloads with `Content-Disposition` filenames slugged from author/date/title. PDF rendered via `pdfkit` with a serif type pairing (Times-Roman body, Times-Italic emphasis, Helvetica labels) and structured rendering of TEI sections; EPUB 3 hand-built with `jszip` (mimetype-first, container.xml, OPF with Dublin Core, nav.xhtml, single XHTML document, embedded CSS); TEI passes through `documents.tei_xml` byte-for-byte when present and otherwise synthesises a minimal P5-conformant document from metadata + transcription. Structural invariants are unit-tested in `server/src/__tests__/export.test.ts`. Optional `npm run validate-tei -w server` shells out to `xmllint --relaxng tei_all.rng`; `npm run validate-epub -w server` shells out to `epubcheck` (or `java -jar $EPUBCHECK_JAR`); both skip cleanly when the tool is absent.
- [ ] **Letters of Theodore Roosevelt corpus (~150,000 items)** — XL — depends on partnership with the Theodore Roosevelt Center. Acceptance: ingestion of the full Morison/Blum Harvard edition with structured recipients and dates.

### Pillar 2 — Intelligent Search

- [x] **FTS5 with snippet highlighting and BM25 ranking** — done in POC
- [ ] **Migrate search to Meilisearch** — M — self-hosted free, or Meilisearch Cloud ($30+/mo). Acceptance: same `/api/search` contract, typo tolerance, faceted filters return in <100ms at p99 over the full corpus.
- [ ] **Semantic search via embeddings** — L — OpenAI `text-embedding-3-small` (~$0.02/1M tokens) or local `bge-small-en` + pgvector. Acceptance: `/api/search?semantic=1` returns conceptually-related results not lexically matched.
- [x] **Network graph of correspondents** — L — implemented with Cytoscape.js: new `/network` page renders an undirected co-occurrence graph derived from each letter's `recipient` plus a curated `mentions: string[]` field on documents (migration `005_mentions.sql`, mirrors the `tags` JSON-array convention). Server endpoint `GET /api/correspondents/graph` returns `{nodes, edges, letters}`; the client filters those locally to show, on node click, that person's letters (linked to `/documents/:id`) and a focused subgraph of their direct neighbors. TR appears as a highlighted hub; node size scales with letter count, edge width with co-occurrence weight.
- [x] **Topic modeling (BERTopic)** — L — implemented as a Python sidecar (`python/topic_model.py`, invoked via `npm run topic-model` or auto-run by the build orchestrator when ingest reports new/updated rows) that reads the configured library DB via `libsql_client` (Turso in prod, `file:./data/library.db` in dev), embeds transcribed documents with `sentence-transformers/all-MiniLM-L6-v2`, fits BERTopic (UMAP → HDBSCAN → c-TF-IDF), reduces to ≤60 topics, and writes a single transactional snapshot into the `topics`, `document_topics`, and `topic_drift` tables defined in migration `006_topics.sql`. The server exposes three read-only endpoints — `GET /api/topics`, `GET /api/topics/:id` (top-25 member documents joined to `documents`), and `GET /api/topics/drift?bin=year` — registered in OpenAPI via `shared/src/schemas/topic.ts`. The client renders a new `/topics` page with a theme grid (label, top-5 keyword chips, doc count, share-over-time sparkline) and a `/topics/:id` detail view (top-15 keyword bar chart, full-period drift line chart, top-25 member docs linking back to `/documents/:id`); all charts are hand-rolled SVG, consistent with the timeline. The 30–60 theme target assumes the full ~150k Morison corpus; on the 8-document POC corpus the pipeline produces ≤1 topic and the page shows an empty-state hint. Design: `docs/topic-modeling.md`.
- [x] **Sentiment analysis** — M — implemented as a Python sidecar (`python/sentiment.py`, invoked via `npm run sentiment` or auto-run by the build orchestrator when ingest reports new/updated rows) that reads the configured library DB via `libsql_client` (Turso in prod, `file:./data/library.db` in dev) and scores each transcribed document with VADER (`vaderSentiment`, sentence-level length-weighted compound, written in a single transaction to the `document_sentiment` table from migration `007_sentiment.sql`). Per-document records carry `polarity` (compound `[-1, 1]`), `pos`/`neu`/`neg`, a derived `label` (positive/neutral/negative at VADER's standard `±0.05` thresholds), and the `model_version` (`<git_sha>:vader==<version>`). Three read-only endpoints in `server/src/routes/sentiment.ts` — `GET /api/sentiment/timeline?bin=month|year&from&to` (mean polarity grouped by month or year over an optional date range), `GET /api/sentiment/extremes?from&to&limit` (most positive / most negative documents in range), and `GET /api/sentiment/documents/:id` — are registered in OpenAPI via `shared/src/schemas/sentiment.ts`. The client renders a new `/sentiment` page with a hand-rolled SVG mood chart (zero-baseline, `[-1, +1]` y-domain) defaulting to "TR's mood across the 1912 campaign" (`1912-01-01` → `1912-12-31`, monthly bins) plus most-positive / most-negative document lists; document detail pages show a polarity badge. The 1912 demo will be empty until the full ~150k Morison corpus is loaded — the page surfaces an explicit empty-state hint in that case, mirroring topic modeling.

### Pillar 3 — Scholarly Apparatus

- [x] **Annotations system (W3C Web Annotations)** — L — implemented behind a Google sign-in gate, with annotations persisted in a separate writable backend so the document database stays read-only in production. The `@tr/shared` package defines W3C-compliant Zod schemas for `Annotation`, `TextQuoteSelector`, `TextPositionSelector`, `FragmentSelector` and `AnnotationCollection` (`shared/src/schemas/annotation.ts`). Auth flows through Google Identity Services: the client renders the official `gsi/client` button, posts the credential to `POST /api/auth/google`, and the server verifies the ID token via `google-auth-library`, upserts a row in `users`, creates a row in `sessions`, and returns an HMAC-signed HTTP-only `tr_session` cookie (`server/src/auth/{google,session,users}.ts`). Annotations live in libSQL — local file (`data/annotations.db`) for dev, Turso for prod — opened via `@libsql/client` with migrations under `server/src/annotations-migrations/`. The CRUD endpoints are W3C-shaped: `POST /api/annotations` (auth required, validates `documentId` against the read-only doc DB), `GET /api/annotations/:id` (content-negotiates `application/ld+json` → adds `@context: http://www.w3.org/ns/anno.jsonld`), `GET /api/documents/:id/annotations` (returns an `AnnotationCollection`, public), `PATCH` and `DELETE` (author-only). Notes are public by default. The reader (`client/src/components/TranscriptionPane.tsx`) wraps existing annotation ranges in `<mark>` overlays located via TextQuoteSelector with TextPositionSelector fallback (`client/src/lib/selection.ts`); selecting any passage while signed in surfaces an `AnnotationToolbar` for **Highlight** / **Add note**. Each note is referenceable at `/annotations/:id` (via `client/src/pages/AnnotationPage.tsx`, which redirects to `/documents/:documentId#anno-:id` and flashes the highlight on arrival) and exportable as JSON-LD via the popover's "Open JSON-LD" / "Copy as JSON-LD" actions.
- [ ] **Expert essay CMS** — M — MDX in repo or Sanity ($99+/mo). Acceptance: subject-matter experts can publish contextual essays linked to specific documents.
- [ ] **Cross-reference linking engine** — L — Acceptance: when document A mentions document B by date or correspondent, a sidebar link appears automatically.
- [ ] **Draft-vs-final diff viewer** — M — `diff-match-patch`. Acceptance: any document with multiple versions shows a side-by-side highlighted diff.
- [ ] **Biographical timeline data model** — M — Acceptance: a normalized events table (born, married, elected, …) renders alongside the document timeline.

### Pillar 4 — Accessibility & Open Access

- [x] **Skip-to-content, ARIA tablist, focus rings, dark mode** — POC baseline
- [ ] **WCAG 2.2 AA audit** — M — Axe + Pa11y in CI; manual screen-reader pass with NVDA + VoiceOver. Acceptance: zero serious violations.
- [ ] **Screen reader testing** — S — Acceptance: every page is fully usable in NVDA, JAWS, and VoiceOver.
- [ ] **Text-to-speech via Web Speech API** — S — Acceptance: a "Read aloud" button reads the transcription in the user's preferred voice.
- [ ] **Translations via i18next** — L — community-sourced. Acceptance: at minimum English + Spanish UI; document-level translations contributed via PR.
- [ ] **DOI minting via DataCite** — M — DataCite membership ~$2,500/yr. Acceptance: every document has a citable DOI resolved to its persistent URL.
- [ ] **Persistent URLs** — S — Acceptance: documented URL contract; `/documents/:id` never breaks across refactors.
- [ ] **User accounts for saved collections** — L — Auth.js + Postgres. Acceptance: users can save, tag, and share document collections.

### Pillar 5 — Interactive & Community

- [ ] **Public REST + GraphQL APIs with rate limiting** — M — Acceptance: REST already exists; GraphQL endpoint at `/api/graphql`; default 60 req/min per IP, 1k for keyed clients.
- [ ] **Geographic correspondence map (Leaflet/Mapbox)** — M — Mapbox tier ~$0+/mo at low volume. Acceptance: pins for every recipient location; clicking opens letters.
- [ ] **Word frequency visualizations** — S — Acceptance: per-document and corpus-wide word clouds, filterable by date range.
- [ ] **Moderated annotation system** — M — Acceptance: annotation queue with admin UI; spam detection.
- [ ] **Contributor verification** — L — ORCID OAuth. Acceptance: scholars sign in with ORCID and contributions are signed.
- [ ] **Audio readings (volunteer-recorded)** — L — Acceptance: per-document audio clips streamed from S3 with transcript synchronization.

---

## 5. Deployment

### Docker (sketch)

```dockerfile
# server
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY server ./server
COPY shared ./shared
COPY data ./data
RUN npm ci --workspaces --include-workspace-root
EXPOSE 3001
CMD ["npm","start","-w","server"]
```

For the client, run `npm run build -w client` and serve `client/dist/` from any
static host (Cloudflare Pages, Netlify, S3+CloudFront).

### Hosting recommendations

| Stage      | Recommendation                                                                 |
| ---------- | ------------------------------------------------------------------------------ |
| POC / demo | **Fly.io** or **Railway** for the server; **Cloudflare Pages** for the client. |
| At scale   | AWS: ECS Fargate (server) + RDS Postgres + S3 + CloudFront + IIIF on EC2/ECS.  |
| CDN        | Cloudflare or CloudFront in front of facsimiles and the static client bundle.  |

### Environment variables

| Variable                       | Default                              | Notes                                                                                                               |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `PORT`                         | `3001`                               | Server listen port                                                                                                  |
| `VITE_API_BASE`                | empty (uses Vite proxy)              | Set for production client builds                                                                                    |
| `GOOGLE_CLIENT_ID`             | unset                                | Google OAuth 2.0 Web client id; required for `/api/auth/google` to be registered                                    |
| `VITE_GOOGLE_CLIENT_ID`        | unset                                | Same client id, exposed to the SPA so the Google Identity Services button can render                                |
| `SESSION_SECRET`               | dev-only fallback (insecure)         | HMAC key for signed `tr_session` cookies. Must be set in production. `openssl rand -hex 32`                         |
| `TURSO_LIBRARY_DATABASE_URL`   | `file:data/library.db` (dev)         | libSQL/Turso URL holding the document corpus (`documents`, `document_sections`, topics, sentiment). Required in production. |
| `TURSO_LIBRARY_AUTH_TOKEN`     | unset                                | Bearer token for the library Turso DB (production only; not needed for the local `file:` URL).                     |
| `TURSO_DATABASE_URL`           | `file:data/annotations.db` (dev)     | libSQL/Turso URL holding `users` / `sessions` / `annotations`. Defaults to a local file in dev.                     |
| `TURSO_AUTH_TOKEN`             | unset                                | Bearer token for the annotations Turso DB (production only; not needed for the local file URL).                     |
| `PIP_CACHE_DIR`                | `/opt/build/cache/pip` (Netlify)     | Set in `netlify.toml` so `pip install` reuses wheels across builds.                                                 |
| `HF_HOME` / `TRANSFORMERS_CACHE` / `SENTENCE_TRANSFORMERS_HOME` | `/opt/build/cache/huggingface…` (Netlify) | Pin HuggingFace caches to a Netlify-cached path so the ~500 MB sentence-transformers download survives rebuilds.   |

### Build-time ingest + analysis

The Netlify build runs `npm run ingest` (a thin wrapper around
`scripts/run-build-ingest.mjs`) before `npm run build`. The orchestrator:

1. Skips with a warning if `TURSO_LIBRARY_DATABASE_URL` is not set, so PR
   previews and forks without the secret build cleanly.
2. Runs `npm run ingest-loc -w server` and (if a `tei/` folder exists at the
   repo root) `npm run ingest-tei -w server -- tei` against the configured
   Turso DB. Both ingests are idempotent: each one short-circuits per-record
   when the document is already present (LoC) or its TEI hash is unchanged
   (TEI), and finishes in seconds when there is nothing new.
3. Inspects the machine-readable `SUMMARY {...}` line each ingest emits and,
   only when `written + updated > 0`, runs the Python sidecars:
   `pip install -r python/requirements.txt`, then `python python/sentiment.py`,
   then `python python/topic_model.py`. A no-op rebuild therefore skips the
   ~5–15 minute analysis pass entirely. Any Python failure exits non-zero and
   fails the build loudly — the same contract as the ingest steps.

Helpful escape hatches when running the orchestrator locally:

- `SKIP_ANALYSIS=1` — never run sentiment / topic-model.
- `SKIP_PIP_INSTALL=1` — assume Python deps are already installed.
- `FORCE_ANALYSIS=1` — run sentiment + topic-model even if the ingest was a no-op.

#### First-time seed (Turso)

```bash
# 1. Create a Turso database for the library and grab its URL + auth token.
turso db create tr-library
export TURSO_LIBRARY_DATABASE_URL="$(turso db show tr-library --url)"
export TURSO_LIBRARY_AUTH_TOKEN="$(turso db tokens create tr-library)"

# 2. (One time) populate it from a local SQLite library DB. Idempotent —
#    re-running is safe; every INSERT uses ON CONFLICT DO NOTHING.
npm run upload-library-to-turso

# 3. Set the same two env vars (plus TURSO_AUTH_TOKEN / GOOGLE_CLIENT_ID /
#    SESSION_SECRET / etc.) in the Netlify site env, then trigger a build.
#    The first deploy will see written + updated > 0 from the LoC adapter and
#    will run sentiment + topic-model; the next deploy with no source change
#    will be a fast no-op.
```

#### Verifying the no-op build path locally

```bash
# 1. Cold build that ingests + runs analysis.
TURSO_LIBRARY_DATABASE_URL="file:./data/library.db" npm run ingest
# → SUMMARY shows written > 0; orchestrator runs sentiment + topic-model.

# 2. Immediate rebuild — no source changes.
TURSO_LIBRARY_DATABASE_URL="file:./data/library.db" npm run ingest
# → ingest-loc / ingest-tei: SUMMARY {"written":0,"updated":0,"skipped":N,...}
# → orchestrator: "[build-ingest] No new corpus rows. Skipping topic-model + sentiment."
# → wall clock < a few seconds, no Python invoked.
```

---

## 6. Contributing

### Code style

- TypeScript strict mode everywhere (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Functional React components with hooks.
- Named exports preferred.
- ESLint + Prettier enforced; run `npm run format` and `npm run lint`.
- Conventional commits: `feat(client): …`, `fix(server): …`, `docs: …`, etc.

### PR process

1. Branch from `main`: `feat/<short-name>`.
2. Write or update tests alongside the change (Vitest).
3. Ensure `npm run lint`, `npm run test`, and `npm run build` all pass.
4. Open a PR; the title should be a conventional commit; the body describes
   intent, screenshots for UI changes, and any data-model migrations.

### How scholars submit transcription corrections

1. Open an issue using the "Transcription correction" template.
2. Identify the document by its `id` (visible in the URL: `/documents/<id>`).
3. Cite the canonical source (LoC, TR Center, Houghton).
4. A maintainer or contributor applies the correction through the document PATCH
   endpoint with an `X-Editor` identity so provenance history records the change.

---

## 7. Licensing & attribution

- **Code:** MIT — see [`LICENSE`](LICENSE).
- **Original code, schemas, and visualizations:** MIT.
- **TR's writings:** public domain in the United States and most jurisdictions
  (TR died in 1919). Where applicable, transcriptions are made available under
  **CC BY 4.0** with attribution to the source repository.
- **Facsimile images:** rights vary by holding institution. Each document
  records its source and `sourceUrl`; we link out rather than re-host whenever
  the host institution requests it.

### Attribution conventions

Every document carries:

- `source` — the repository name (e.g., "Wikisource", "Library of Congress").
- `sourceUrl` — a stable URL to the canonical record.
- `provenance` — a short prose note about how the item came to be.

Citations (Chicago / MLA / APA, generated client-side) include the source URL
and the access date.

---

## 8. Data sources

| Source                                         | Holdings                                           | Rights / digitization                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Library of Congress, TR Papers**             | ~250,000 items: letters, diaries, photographs.     | Largely public domain (pre-1925). Many items digitized and IIIF-available. <https://www.loc.gov/collections/theodore-roosevelt-papers/> |
| **Theodore Roosevelt Center (Dickinson State)** | The Theodore Roosevelt Digital Library — letters, speeches, photographs. | Public domain content; their viewer is permissive but rate limits apply. <https://www.theodorerooseveltcenter.org/>     |
| **Harvard, Houghton Library**                  | Roosevelt family papers; portions of the Morison/Blum *Letters of Theodore Roosevelt*. | Public domain; partial digitization; permissions may be required for facsimile reuse.                                   |
| **Wikisource**                                  | Major published works: speeches, *Rough Riders*, *Autobiography*. | Public domain text; useful future source adapter candidate.                                                             |
| **Project Gutenberg**                           | Full books in plain text and EPUB.                 | Public domain; no API rate limits to speak of for normal use.                                                           |

---

## Appendix — POC verification checklist

- [x] `npm install` succeeds with no errors
- [x] `npm run ingest-loc -- --limit 25` populates LoC documents (full text when available)
- [x] `npm run dev` brings up server (`:3001`) and client (`:5173`)
- [x] `GET /api/documents` returns imported LoC items
- [x] `GET /api/documents/loc-mss382990022` returns a LoC manuscript item with metadata
- [x] `GET /api/search?q=roosevelt` highlights the match with `<mark>` tags
- [x] `GET /api/openapi.json` is a valid OpenAPI 3.1 document
- [x] Browse, Search, Timeline, and Document pages render
- [x] Dark mode toggle persists across reloads (localStorage)
- [x] `npm run test` passes (92 server + 24 client tests)
- [x] `npm run build` succeeds for all three workspaces
- [x] Sign in with Google succeeds (with `GOOGLE_CLIENT_ID` + `VITE_GOOGLE_CLIENT_ID` set)
- [x] Selecting text in the transcription shows the annotation toolbar (signed in only)
- [x] A saved note resolves at `/annotations/:id` and scrolls/flashes its highlight
- [x] `GET /api/annotations/:id` with `Accept: application/ld+json` returns a JSON-LD body whose `@context` is `http://www.w3.org/ns/anno.jsonld`
