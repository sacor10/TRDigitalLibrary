import { parseArgs } from 'node:util';

import { openLibraryDb, syncDocumentChunks } from './db.js';
import { chunkText } from './text/chunk.js';

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * Backfills `document_chunks` (and via its triggers, `document_chunks_fts`) for
 * documents that predate the chunk-snippet index, or whose chunks are missing.
 * Search sources snippets from these bounded chunks instead of running FTS5
 * snippet() over the multi-MB `transcription` column. Idempotent: re-running
 * rebuilds chunks for each document. Runs against whatever DB openLibraryDb()
 * resolves (local file or Turso, per env).
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'only-missing': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(`Usage: npm run backfill-chunks -- [--dry-run] [--only-missing]

Rebuilds the document_chunks bounded-text index used for search snippets.
  --dry-run       report what would change without writing
  --only-missing  only populate documents that currently have no chunks
`);
    return;
  }

  const dryRun = Boolean(values['dry-run']);
  const onlyMissing = Boolean(values['only-missing']);
  const db = await openLibraryDb();
  try {
    const rows = await db.execute('SELECT id, transcription FROM documents ORDER BY id');
    let processed = 0;
    let chunksWritten = 0;
    for (const row of rows.rows) {
      const id = asString(row.id);
      const transcription = asString(row.transcription);
      const chunkCount = chunkText(transcription).length;
      if (dryRun) {
        processed += 1;
        chunksWritten += chunkCount;
        continue;
      }
      await syncDocumentChunks(db, id, transcription, { onlyIfMissing: onlyMissing });
      processed += 1;
      chunksWritten += chunkCount;
    }
    console.log(
      `[backfill-chunks] ${dryRun ? 'would process' : 'processed'} ${processed} document(s), ` +
        `${dryRun ? 'would write up to' : 'wrote up to'} ${chunksWritten} chunk(s)` +
        `${onlyMissing ? ' (only-missing)' : ''}.`,
    );
  } finally {
    db.close();
  }
}

await main();
