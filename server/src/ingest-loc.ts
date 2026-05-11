import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { openLibraryDb, type LibsqlClient } from './db.js';
import { ingestLocCollection, type LocIngestReport } from './sources/loc.js';

/**
 * Tune undici (the runtime backing Node 20's global fetch) for this CLI:
 * keep connections alive across the sequential LoC requests, and shorten
 * the per-request header/body timeouts so a stalled socket fails fast and
 * gets retried by fetchWithRetry instead of hanging on the default 5-minute
 * undici timeout. Imported dynamically so loc.ts itself stays free of
 * runtime-specific side effects and unit tests are unaffected.
 */
async function configureUndiciDispatcher(): Promise<void> {
  try {
    // Built into Node 18+; intentionally referenced through a variable so
    // TypeScript does not try to resolve it at compile time (no @types).
    const moduleName = 'undici';
    const undici = (await import(moduleName)) as {
      setGlobalDispatcher: (d: unknown) => void;
      Agent: new (opts: Record<string, unknown>) => unknown;
    };
    undici.setGlobalDispatcher(
      new undici.Agent({
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 60_000,
        connections: 4,
        headersTimeout: 30_000,
        bodyTimeout: 120_000,
        connect: { timeout: 15_000 },
      }),
    );
  } catch {
    // Non-Node environments may not expose 'undici'; the per-stage
    // AbortController in fetchWithTimeout is still in play, so we
    // simply fall back to the default fetch behaviour.
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  dbPath: string;
  /**
   * True when `--db` was passed on the CLI. When false, the env var
   * `TURSO_LIBRARY_DATABASE_URL` is allowed to win in `openLibraryDb`; when
   * true, the local file path overrides everything.
   */
  dbPathExplicit: boolean;
  dryRun: boolean;
  reset: boolean;
  force: boolean;
  limit?: number;
  startPage: number;
  /** True when --start-page was passed explicitly (disables auto-resume). */
  startPageExplicit: boolean;
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
      'chunk-size': { type: 'string' },
      'start-page': { type: 'string', default: '1' },
      db: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
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

  // parseArgs hides the difference between "default applied" and "user passed
  // --start-page 1"; we need to know explicit user intent so auto-resume can
  // be disabled when the operator overrides the cursor.
  const startPageExplicit = argv.some(
    (a) => a === '--start-page' || a.startsWith('--start-page='),
  );

  const defaultDbPath = join(__dirname, '..', '..', 'data', 'library.db');
  const startPage = positiveInt(values['start-page'], '--start-page') ?? 1;
  const opts: CliOptions = {
    dbPath: values.db ? resolve(values.db) : defaultDbPath,
    dbPathExplicit: values.db != null,
    dryRun: Boolean(values['dry-run']),
    reset: Boolean(values.reset),
    force: Boolean(values.force),
    startPage,
    startPageExplicit,
  };
  const chunkSize = positiveInt(values['chunk-size'], '--chunk-size');
  const limit = positiveInt(values.limit, '--limit');
  const effectiveLimit = limit ?? chunkSize;
  if (effectiveLimit != null) opts.limit = effectiveLimit;
  if (values.editor) opts.editor = values.editor;
  return opts;
}

function printUsage(): void {
  console.log(`Usage: npm run ingest-loc -- [options]

Imports source-item records from the Library of Congress Theodore Roosevelt Papers.

Options:
  --limit <n>       Maximum number of LoC items to ingest (alias: --chunk-size)
  --chunk-size <n>  Synonym for --limit; used by the build orchestrator
  --start-page <n>  LoC collection page to start from (default: auto-resume
                    from ingest_progress, or 1 on first run)
  --db <path>       Database path (default: data/library.db)
  --dry-run         Fetch and map records but do not write the database
  --reset           Clear existing corpus rows (and resume cursor) before importing
  --force           Bypass the fast no-op skip-if-exists check (re-fetch every item)
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
  if (!report.dryRun) console.log(`  inserted:         ${report.written}`);
  if (!report.dryRun) console.log(`  skipped (cached): ${report.skipped}`);
  console.log(`  completed:        ${report.completed}`);
  if (report.nextPage) {
    console.log(`  resume next build at page: ${report.nextPage} (auto via ingest_progress)`);
  }
  // Machine-readable summary line for the build orchestrator. Keeping the
  // shape stable: { source, scanned, written, skipped, failed, dryRun }.
  // Adds nextPage + completed for diagnostics; the orchestrator ignores
  // unknown keys.
  const summary = {
    source: 'loc',
    scanned: report.scanned,
    written: report.written,
    updated: 0,
    skipped: report.skipped,
    failed: report.failed,
    nextPage: report.nextPage,
    completed: report.completed,
    dryRun: report.dryRun,
  };
  console.log(`SUMMARY ${JSON.stringify(summary)}`);
}

async function main(): Promise<void> {
  await configureUndiciDispatcher();
  const opts = parseCliArgs(process.argv.slice(2));
  let db: LibsqlClient | null = null;
  if (!opts.dryRun) {
    // Only force a local file URL when the operator explicitly passed --db.
    // Without it, fall through to openLibraryDb's resolution chain
    // (TURSO_LIBRARY_DATABASE_URL → local file fallback) so production builds
    // write to Turso. The previous code always passed url=file:..., which
    // silently masked the env var and made every Netlify build write to a
    // throwaway path inside the build container.
    if (opts.dbPathExplicit) {
      mkdirSync(dirname(opts.dbPath), { recursive: true });
      db = await openLibraryDb({ url: `file:${opts.dbPath}` });
      console.log(`[ingest-loc] db: file:${opts.dbPath} (explicit --db)`);
    } else {
      db = await openLibraryDb();
      const envUrl = process.env.TURSO_LIBRARY_DATABASE_URL ?? '(local file fallback)';
      // Don't print the auth token; print only the URL host so the user can
      // confirm in the build log that the right Turso instance was reached.
      const host = (() => {
        try {
          return new URL(envUrl.replace(/^libsql:/, 'https:')).host;
        } catch {
          return envUrl;
        }
      })();
      console.log(`[ingest-loc] db: ${envUrl.startsWith('file:') ? envUrl : `libsql://${host}`}`);
    }
  }

  try {
    const ingestOptions: Parameters<typeof ingestLocCollection>[0] = {
      db,
      dryRun: opts.dryRun,
      reset: opts.reset,
      force: opts.force,
      // When the operator does not pass --start-page explicitly, let the
      // ingest read the resume cursor from ingest_progress. --reset clears
      // the cursor inside resetLibraryCorpus, so auto-resume on a reset run
      // safely starts at page 1.
      autoResume: !opts.startPageExplicit,
    };
    if (opts.startPageExplicit) ingestOptions.startPage = opts.startPage;
    if (opts.limit != null) ingestOptions.limit = opts.limit;
    if (opts.editor) ingestOptions.editor = opts.editor;
    // Read concurrency from the env so the orchestrator (or operator) can
    // tune it without recompiling. Non-positive values fall back to the
    // library default.
    const concurrencyEnv = process.env.INGEST_CONCURRENCY;
    if (concurrencyEnv) {
      const n = Number(concurrencyEnv);
      if (Number.isInteger(n) && n > 0) {
        ingestOptions.concurrency = n;
      } else {
        console.warn(
          `[ingest-loc] INGEST_CONCURRENCY="${concurrencyEnv}" is not a positive integer; using default.`,
        );
      }
    }
    console.log(
      `[ingest-loc] starting: limit=${opts.limit ?? '∞'} concurrency=${ingestOptions.concurrency ?? 'default'}`,
    );
    const report = await ingestLocCollection(ingestOptions);
    printReport(report);
    // Exit codes:
    //   - 0 when we wrote anything (progress!) or the collection is complete
    //     (scanned=0 means autoResume early-exited on a completed cursor).
    //   - 0 when we scanned items but had only retryable failures — the
    //     cursor was held, the next build will retry, and failing this build
    //     would mask that recovery path behind a red banner.
    //   - 1 when we scanned items, wrote nothing, AND had failures: that's a
    //     real "stuck" condition that an operator should notice.
    const noProgressWithFailures =
      report.scanned > 0 && report.written === 0 && report.failed > 0;
    process.exit(noProgressWithFailures ? 1 : 0);
  } finally {
    db?.close();
  }
}

await main();
