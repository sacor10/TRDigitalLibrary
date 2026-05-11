import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { openLibraryDb, type LibsqlClient } from './db.js';
import {
  ingestTrcCorrespondence,
  type TrcIngestReport,
  type TrcResourceType,
} from './sources/trc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  dbPath: string;
  dbPathExplicit: boolean;
  dryRun: boolean;
  reset: boolean;
  limit?: number;
  startPage?: number;
  pageSize?: number;
  delayMs?: number;
  resourceTypes?: TrcResourceType[];
}

function positiveInt(raw: string | undefined, name: string): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return n;
}

function nonNegativeInt(raw: string | undefined, name: string): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return n;
}

function parseResourceTypes(raw: string | undefined): TrcResourceType[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  for (const value of values) {
    if (value !== 'letter' && value !== 'telegram') {
      throw new Error('--resource-types must contain only letter and/or telegram');
    }
  }
  return values as TrcResourceType[];
}

function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      limit: { type: 'string' },
      'chunk-size': { type: 'string' },
      'start-page': { type: 'string' },
      'page-size': { type: 'string' },
      'delay-ms': { type: 'string' },
      'resource-types': { type: 'string' },
      db: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
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
  const opts: CliOptions = {
    dbPath: values.db ? resolve(values.db) : defaultDbPath,
    dbPathExplicit: values.db != null,
    dryRun: Boolean(values['dry-run']),
    reset: Boolean(values.reset),
  };

  const chunkSize = positiveInt(values['chunk-size'], '--chunk-size');
  const limit = positiveInt(values.limit, '--limit') ?? chunkSize;
  const startPage = positiveInt(values['start-page'], '--start-page');
  const pageSize = positiveInt(values['page-size'], '--page-size');
  const delayMs = nonNegativeInt(values['delay-ms'], '--delay-ms');
  const resourceTypes = parseResourceTypes(values['resource-types']);

  if (limit != null) opts.limit = limit;
  if (startPage != null) opts.startPage = startPage;
  if (pageSize != null) opts.pageSize = pageSize;
  if (delayMs != null) opts.delayMs = delayMs;
  if (resourceTypes) opts.resourceTypes = resourceTypes;
  return opts;
}

function printUsage(): void {
  console.log(`Usage: npm run ingest-trc -- [options]

Imports metadata-only correspondence edges from the Theodore Roosevelt Center Digital Library.

Options:
  --limit <n>          Maximum TRC result cards to ingest this run (alias: --chunk-size)
  --chunk-size <n>     Synonym for --limit
  --start-page <n>     TRC result page to start from; disables auto-resume
  --page-size <n>      TRC result page size, capped by the source at 50
  --delay-ms <n>       Delay between TRC page requests (default: 10000, from robots.txt)
  --resource-types <x> Comma-separated subset: letter,telegram
  --db <path>          Database path (default: data/library.db)
  --dry-run            Fetch and parse metadata but do not write the database
  --reset              Clear existing TRC network rows and TRC cursors before importing
  -h, --help           Show this help
`);
}

function printReport(report: TrcIngestReport): void {
  console.log(`\nTRC correspondence ingest report${report.dryRun ? ' (dry run)' : ''}`);
  console.log(`  pages fetched: ${report.pagesFetched}`);
  console.log(`  scanned:       ${report.scanned}`);
  console.log(`  mapped:        ${report.mapped}`);
  console.log(`  written:       ${report.written}`);
  console.log(`  skipped:       ${report.skipped}`);
  console.log(`  failed:        ${report.failed}`);
  console.log(`  completed:     ${report.completed}`);
  for (const job of report.jobs) {
    if (!job.completed && job.nextPage) {
      console.log(`  resume ${job.source} at page ${job.nextPage}`);
    }
  }
  console.log(
    `SUMMARY ${JSON.stringify({
      source: 'trc',
      scanned: report.scanned,
      written: report.written,
      updated: 0,
      skipped: report.skipped,
      failed: report.failed,
      completed: report.completed,
      dryRun: report.dryRun,
    })}`,
  );
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  let db: LibsqlClient | null = null;
  if (!opts.dryRun) {
    if (opts.dbPathExplicit) {
      mkdirSync(dirname(opts.dbPath), { recursive: true });
      db = await openLibraryDb({ url: `file:${opts.dbPath}` });
      console.log(`[ingest-trc] db: file:${opts.dbPath} (explicit --db)`);
    } else {
      db = await openLibraryDb();
      const envUrl = process.env.TURSO_LIBRARY_DATABASE_URL ?? '(local file fallback)';
      const host = (() => {
        try {
          return new URL(envUrl.replace(/^libsql:/, 'https:')).host;
        } catch {
          return envUrl;
        }
      })();
      console.log(`[ingest-trc] db: ${envUrl.startsWith('file:') ? envUrl : `libsql://${host}`}`);
    }
  }

  try {
    const report = await ingestTrcCorrespondence({
      db,
      dryRun: opts.dryRun,
      reset: opts.reset,
      autoResume: opts.startPage == null,
      ...(opts.startPage != null ? { startPage: opts.startPage } : {}),
      ...(opts.limit != null ? { limit: opts.limit } : {}),
      ...(opts.pageSize != null ? { pageSize: opts.pageSize } : {}),
      ...(opts.delayMs != null ? { delayMs: opts.delayMs } : {}),
      ...(opts.resourceTypes ? { resourceTypes: opts.resourceTypes } : {}),
    });
    printReport(report);
    process.exit(report.failed > 0 && report.written === 0 ? 1 : 0);
  } finally {
    db?.close();
  }
}

await main();
