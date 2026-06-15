import { parseArgs } from 'node:util';

import { openLibraryDb, optimizeFtsIndexes } from './db.js';

/**
 * One-off FTS5 maintenance: merge the accumulated index segments for the corpus
 * full-text indexes so `MATCH` stays fast.
 *
 * External-content FTS5 appends a new segment on every insert/update. A corpus
 * built incrementally over many ingest runs ends up fragmented into many
 * segments, and broad keyword searches slow down until they can time out (504).
 * The ingest CLIs now run this automatically on completion, but an existing
 * production database needs a one-time pass — that's what this script is for.
 *
 * Targets whatever `openLibraryDb` resolves: `TURSO_LIBRARY_DATABASE_URL` in
 * production, the local file otherwise. Run against Turso with:
 *   TURSO_LIBRARY_DATABASE_URL=... TURSO_LIBRARY_AUTH_TOKEN=... npm run optimize-fts
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { help: { type: 'boolean', short: 'h', default: false } },
  });

  if (values.help) {
    console.log(`Usage: npm run optimize-fts

Merges FTS5 index segments for documents_fts and sections_fts. Reads the target
database from TURSO_LIBRARY_DATABASE_URL (production) or the local file fallback.
`);
    return;
  }

  const db = await openLibraryDb();
  try {
    const t0 = performance.now();
    console.log('[optimize-fts] optimizing FTS indexes...');
    await optimizeFtsIndexes(db);
    console.log(`[optimize-fts] done in ${((performance.now() - t0) / 1000).toFixed(1)}s.`);
  } finally {
    db.close();
  }
}

await main();
