# AGENTS.md

## Cursor Cloud specific instructions

### Overview

TR Digital Library is an npm workspaces monorepo with three packages: `@tr/shared` (Zod schemas), `@tr/server` (Express + SQLite API on :3001), and `@tr/client` (React + Vite SPA on :5173). No Docker, no external databases — SQLite is file-based at `data/library.db`.

### Running the app

See the Quick Start in `README.md`. The essential commands are:

```
npm run seed    # creates/populates data/library.db (needs outbound HTTPS; graceful without it)
npm run dev     # starts server (:3001) + client (:5173) concurrently
```

### Lint / Test / Build

```
npm run lint    # ESLint across all workspaces
npm run test    # Vitest: 35 server + 4 client tests
npm run build   # tsc --noEmit + vite build
```

### Non-obvious notes

- **ESLint resolver errors**: The ESLint config references `eslint-import-resolver-typescript` but it is not listed in `devDependencies`. Running `npm run lint` produces many `import/namespace` "Resolve error: typescript with invalid interface loaded as resolver" errors. These are pre-existing and do not affect runtime or tests.
- **Client build TypeScript error**: `npm run build` fails on the client workspace due to a pre-existing missing `teiXml` property in `client/src/lib/citation.test.ts`. The Vite dev server (`npm run dev`) is unaffected since it does not run `tsc`.
- **Seed failures are normal**: Some Wikisource URLs return 404. The seed script still inserts all 8 documents with metadata; transcriptions are empty for failed fetches. This is by design.
- **Database location**: `data/library.db` is gitignored and must be regenerated via `npm run seed` after a fresh clone.
- **No `.env` required**: All env vars (`PORT`, `DATABASE_URL`, `VITE_API_BASE`) have sensible defaults.
