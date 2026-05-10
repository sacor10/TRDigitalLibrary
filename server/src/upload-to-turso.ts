/**
 * One-shot bootstrap: copy a local SQLite library DB into Turso, idempotently.
 *
 * Usage:
 *   npm run upload-library-to-turso
 *
 * Reads from the local file (default: data/library.db; override with
 * --source <path> or LIBRARY_SOURCE_DB) and writes to the Turso DB pointed
 * at by TURSO_LIBRARY_DATABASE_URL + TURSO_LIBRARY_AUTH_TOKEN. Every INSERT
 * uses an idempotent conflict clause so re-running the script is safe.
 *
 * The schema is applied automatically by openLibraryDb (it runs every
 * migration in server/src/migrations/), so you can point this at a brand-new
 * Turso database. FTS5 indexes (documents_fts, sections_fts) are not copied
 * directly — they are content tables backed by the regular tables, so the
 * triggers in 001_init.sql and 002_tei.sql rebuild them automatically as we
 * INSERT into documents and document_sections.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import type { Client as LibsqlClient, InStatement, InValue } from '@libsql/client';

import { openLibraryDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  sourcePath: string;
  /** When true, also copy the per-field provenance history rows by id. */
  withHistory: boolean;
  /** When true, only print the row counts the script would copy. */
  dryRun: boolean;
}

function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: 'string' },
      'with-history': { type: 'boolean', default: true },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    printUsage();
    process.exit(0);
  }
  const defaultSource =
    process.env.LIBRARY_SOURCE_DB ?? join(__dirname, '..', '..', 'data', 'library.db');
  const sourcePath = values.source ? resolve(values.source) : defaultSource;
  return {
    sourcePath,
    withHistory: Boolean(values['with-history']),
    dryRun: Boolean(values['dry-run']),
  };
}

function printUsage(): void {
  console.log(`Usage: npm run upload-library-to-turso [-- options]

Copies every row of a local SQLite library DB into the Turso DB pointed at by
TURSO_LIBRARY_DATABASE_URL + TURSO_LIBRARY_AUTH_TOKEN. Idempotent: every INSERT
uses ON CONFLICT DO NOTHING, so re-running is safe.

Options:
  --source <path>     Source SQLite file (default: data/library.db, or
                      LIBRARY_SOURCE_DB env var)
  --with-history      Copy document_field_provenance_history rows by id
                      (default: true; pass --no-with-history to skip)
  --dry-run           Print row counts only; do not write to Turso
  -h, --help          Show this help
`);
}

interface TableSpec {
  name: string;
  /** Column list in INSERT order. */
  columns: string[];
  /**
   * SQLite expression after `INSERT INTO {name} ({columns}) VALUES (...) ` —
   * usually `ON CONFLICT(...) DO NOTHING`. The conflict target depends on the
   * table's natural key.
   */
  conflict: string;
}

const TABLES: TableSpec[] = [
  {
    name: 'documents',
    columns: [
      'id',
      'title',
      'type',
      'date',
      'recipient',
      'location',
      'author',
      'transcription',
      'transcription_url',
      'transcription_format',
      'facsimile_url',
      'iiif_manifest_url',
      'provenance',
      'source',
      'source_url',
      'tags',
      'mentions',
      'tei_xml',
      'tei_source_hash',
    ],
    conflict: 'ON CONFLICT(id) DO NOTHING',
  },
  {
    name: 'document_sections',
    columns: [
      'id',
      'document_id',
      'parent_id',
      'order',
      'level',
      'type',
      'n',
      'heading',
      'text',
      'xml_fragment',
    ],
    conflict: 'ON CONFLICT(id) DO NOTHING',
  },
  {
    name: 'document_field_provenance',
    columns: ['document_id', 'field', 'source_url', 'fetched_at', 'editor'],
    conflict: 'ON CONFLICT(document_id, field) DO NOTHING',
  },
  {
    name: 'topics',
    columns: ['id', 'label', 'keywords', 'size', 'computed_at', 'model_version'],
    conflict: 'ON CONFLICT(id) DO NOTHING',
  },
  {
    name: 'document_topics',
    columns: ['document_id', 'topic_id', 'probability'],
    conflict: 'ON CONFLICT(document_id, topic_id) DO NOTHING',
  },
  {
    name: 'topic_drift',
    columns: ['topic_id', 'period', 'document_count', 'share'],
    conflict: 'ON CONFLICT(topic_id, period) DO NOTHING',
  },
  {
    name: 'document_sentiment',
    columns: [
      'document_id',
      'polarity',
      'pos',
      'neu',
      'neg',
      'label',
      'sentence_count',
      'computed_at',
      'model_version',
    ],
    conflict: 'ON CONFLICT(document_id) DO NOTHING',
  },
];

const HISTORY_TABLE: TableSpec = {
  name: 'document_field_provenance_history',
  columns: [
    'id',
    'document_id',
    'field',
    'previous_value',
    'new_value',
    'source_url',
    'fetched_at',
    'editor',
    'recorded_at',
  ],
  // No explicit unique constraint on the history table beyond its
  // autoincrement primary key, so an explicit id-based conflict target keeps
  // the upload idempotent across reruns. (SQLite's default rowid AUTOINCREMENT
  // PK does qualify as a conflict target.)
  conflict: 'ON CONFLICT(id) DO NOTHING',
};

const BATCH_SIZE = 100;

async function copyTable(
  source: LibsqlClient,
  dest: LibsqlClient,
  spec: TableSpec,
  dryRun: boolean,
): Promise<{ scanned: number; written: number }> {
  const quotedCols = spec.columns.map((c) => (c === 'order' ? '"order"' : c));
  const colList = quotedCols.join(', ');
  const placeholders = spec.columns.map(() => '?').join(', ');
  const insertSql = `INSERT INTO ${spec.name} (${colList}) VALUES (${placeholders}) ${spec.conflict}`;

  // First, sanity-check that the source actually has the columns we expect.
  // openLibraryDb has run all migrations on the source so missing columns
  // would mean the source predates a migration we now require — bail loudly.
  const probe = await source.execute({
    sql: `SELECT ${colList} FROM ${spec.name} LIMIT 0`,
  });
  if (probe.columns.length !== spec.columns.length) {
    throw new Error(
      `Source table ${spec.name} has ${probe.columns.length} matching columns; expected ${spec.columns.length}`,
    );
  }

  // Stream rows out in batches; libsql doesn't expose a real cursor so we
  // page with LIMIT/OFFSET. Tables here are small (low thousands of rows
  // total), so this is plenty.
  let scanned = 0;
  let written = 0;
  let offset = 0;
  while (true) {
    const page = await source.execute({
      sql: `SELECT ${colList} FROM ${spec.name} LIMIT ? OFFSET ?`,
      args: [BATCH_SIZE, offset],
    });
    if (page.rows.length === 0) break;
    scanned += page.rows.length;

    if (!dryRun) {
      const stmts: InStatement[] = page.rows.map((row) => {
        const args = spec.columns.map((col) => row[col] as InValue);
        return { sql: insertSql, args };
      });
      const results = await dest.batch(stmts, 'write');
      for (const r of results) {
        if (r.rowsAffected > 0) written += 1;
      }
    }

    offset += page.rows.length;
    if (page.rows.length < BATCH_SIZE) break;
  }
  return { scanned, written };
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));

  if (!existsSync(opts.sourcePath)) {
    console.error(
      `[upload-library-to-turso] source DB not found at ${opts.sourcePath}. ` +
        `Run \`npm run ingest-loc\` (and \`npm run ingest-tei\`) locally first, ` +
        `or pass --source <path>.`,
    );
    process.exit(1);
  }

  if (!opts.dryRun && !process.env.TURSO_LIBRARY_DATABASE_URL) {
    console.error(
      '[upload-library-to-turso] TURSO_LIBRARY_DATABASE_URL must be set. ' +
        'Export it (and TURSO_LIBRARY_AUTH_TOKEN) before running this script.',
    );
    process.exit(1);
  }

  console.log(`[upload-library-to-turso] source: file:${opts.sourcePath}`);
  console.log(
    `[upload-library-to-turso] dest:   ${
      process.env.TURSO_LIBRARY_DATABASE_URL ?? '(dry-run; no destination)'
    }`,
  );

  const source = await openLibraryDb({ url: `file:${opts.sourcePath}` });
  // For dry-run we re-use the source as a stand-in dest; we never write to it
  // because dryRun gates the INSERT path.
  const dest = opts.dryRun ? source : await openLibraryDb();

  try {
    const tables = opts.withHistory ? [...TABLES, HISTORY_TABLE] : TABLES;
    let totalScanned = 0;
    let totalWritten = 0;
    for (const spec of tables) {
      const { scanned, written } = await copyTable(source, dest, spec, opts.dryRun);
      totalScanned += scanned;
      totalWritten += written;
      console.log(
        `[upload-library-to-turso] ${spec.name.padEnd(36)} scanned=${scanned} written=${written}`,
      );
    }
    console.log(
      `\n[upload-library-to-turso] Done. total scanned=${totalScanned} written=${totalWritten}` +
        (opts.dryRun ? ' (dry run)' : ''),
    );
  } finally {
    source.close();
    if (dest !== source) dest.close();
  }
}

await main();
