import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { openDatabase } from './db.js';
import { ingestLocCollection, type LocIngestReport } from './sources/loc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  dbPath: string;
  dryRun: boolean;
  reset: boolean;
  limit?: number;
  startPage: number;
  editor?: string;
}

function positiveInt(raw: string | undefined, name: string): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      limit: { type: 'string' },
      'start-page': { type: 'string', default: '1' },
      db: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      editor: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const defaultDbPath = join(__dirname, '..', '..', 'data', 'library.db');
  const startPage = positiveInt(values['start-page'], '--start-page') ?? 1;
  const opts: CliOptions = {
    dbPath: values.db ? resolve(values.db) : defaultDbPath,
    dryRun: Boolean(values['dry-run']),
    reset: Boolean(values.reset),
    startPage,
  };
  const limit = positiveInt(values.limit, '--limit');
  if (limit != null) opts.limit = limit;
  if (values.editor) opts.editor = values.editor;
  return opts;
}

function printUsage(): void {
  console.log(`Usage: npm run ingest-loc -- [options]

Imports source-item records from the Library of Congress Theodore Roosevelt Papers.

Options:
  --limit <n>       Maximum number of LoC items to ingest
  --start-page <n>  LoC collection page to start from (default: 1)
  --db <path>       Database path (default: data/library.db)
  --dry-run         Fetch and map records but do not write the database
  --reset           Clear existing corpus rows before importing
  --editor <name>   Editor identity recorded in field provenance
                   (default: 'loc-ingest')
  -h, --help        Show this help
`);
}

function printReport(report: LocIngestReport): void {
  console.log(`\nLoC ingest report${report.dryRun ? ' (dry run)' : ''}`);
  console.log(`  start page:       ${report.startPage}`);
  console.log(`  pages fetched:    ${report.pagesFetched}`);
  console.log(`  scanned:          ${report.scanned}`);
  console.log(`  mapped:           ${report.mapped}`);
  console.log(`  with full text:   ${report.withFullText}`);
  console.log(`  without text:     ${report.withoutFullText}`);
  console.log(`  failed:           ${report.failed}`);
  if (!report.dryRun) console.log(`  inserted/updated: ${report.written}`);
  if (report.nextPage) {
    console.log(`  resume with:      npm run ingest-loc -- --start-page ${report.nextPage}`);
  }
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  let db = null;
  if (!opts.dryRun) {
    mkdirSync(dirname(opts.dbPath), { recursive: true });
    db = openDatabase(opts.dbPath);
  }

  try {
    const ingestOptions: Parameters<typeof ingestLocCollection>[0] = {
      db,
      dryRun: opts.dryRun,
      reset: opts.reset,
      startPage: opts.startPage,
    };
    if (opts.limit != null) ingestOptions.limit = opts.limit;
    if (opts.editor) ingestOptions.editor = opts.editor;
    const report = await ingestLocCollection(ingestOptions);
    printReport(report);
    process.exit(report.failed > 0 ? 1 : 0);
  } finally {
    db?.pragma('wal_checkpoint(TRUNCATE)');
    db?.pragma('journal_mode = DELETE');
    db?.close();
  }
}

await main();
