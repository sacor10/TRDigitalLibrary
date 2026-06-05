#!/usr/bin/env node
/**
 * Build-time ingest + analysis orchestrator.
 *
 * Runs the LoC, TRC, and TEI ingests against the configured Turso library DB,
 * captures their machine-readable SUMMARY lines, and — only when the
 * corpus actually changed — invokes the JS sentiment bootstrap so the
 * precomputed `document_sentiment` table stays in sync with the documents
 * table. It also backfills sentiment when a no-op ingest finds missing or
 * stale sentiment rows. (Topics are aggregated on the fly from documents.tags;
 * no sidecar needed.)
 *
 * Behaviour:
 *
 *   - If TURSO_LIBRARY_DATABASE_URL is unset, log a warning and exit 0
 *     so PR previews / forks without Turso secrets do not break.
 *   - Run `npm run ingest-loc -w server -- --limit ${INGEST_CHUNK_SIZE}` and
 *     (if a tei/ folder exists at the repo root)
 *     `npm run ingest-tei -w server -- tei`, then verify sentiment coverage.
 *     TRC metadata ingest runs only after sentiment is already healthy; when
 *     sentiment runs, TRC is deferred to the next build to stay under Netlify's
 *     build timeout.
 *   - Each ingest is expected to print a single line of the shape
 *         SUMMARY {"source":"loc","scanned":N,"written":W,...}
 *     We surface this to the build log. Only LoC + TEI are counted toward
 *     the corpus-change gate that controls sentiment analysis; TRC
 *     metadata updates are loaded into separate correspondence tables.
 *   - INGEST_CHUNK_SIZE (default 2000) caps the LoC/TRC ingest per build so a
 *     single Netlify build stays well under the 18-minute wall. The
 *     ingest persists a resume cursor in the `ingest_progress` table, so
 *     subsequent builds pick up where this one left off automatically.
 *   - Child stdout is streamed line-by-line to our stdout so per-page
 *     progress shows up in the Netlify log in real time (the previous
 *     spawnSync + buffered-stdout combo hid all progress until the child
 *     exited, which never happened on a timed-out build).
 *   - A non-zero exit from any ingest fails the build LOUDLY (the plan's
 *     explicit requirement).
 *   - "No new corpus content" — written + updated = 0 across LoC + TEI — is
 *     a successful build, but the script still verifies sentiment coverage
 *     before taking the fast path. Topic tags are repaired/calculated after
 *     corpus ingest so `/topics` never depends on a manual data step. If documents exist without matching
 *     `document_sentiment` rows, the sidecar runs as a backfill.
 *   - Otherwise: run `node scripts/ensure-sentiment.mjs` with remote Turso
 *     writes explicitly enabled. Sentiment failure fails the build loudly.
 *
 * Local parity: running this script with
 *     TURSO_LIBRARY_DATABASE_URL=file:./data/library.db
 * exercises the exact same gating logic without Turso credentials, so
 * the no-op verification step in the plan is testable locally.
 *
 * Escape hatches (handy for local debugging):
 *   - INGEST_CHUNK_SIZE=<n>       cap LoC/TRC ingest at <n> items per build
 *                                (default 1000).
 *   - INGEST_CONCURRENCY=<n>     parallel LoC item fetches per page
 *                                (default 8; read by ingest-loc directly).
 *   - SKIP_ANALYSIS=1            don't run sentiment even if the corpus
 *                                changed.
 *   - FORCE_ANALYSIS=1           run sentiment even if the ingests reported
 *                                a no-op.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { decideSentimentAnalysis } from './sentiment-analysis-decision.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const buildStart = Date.now();
const TRC_BUDGET_CUTOFF_MS = 8 * 60 * 1000;

const TURSO_URL = process.env.TURSO_LIBRARY_DATABASE_URL;
if (!TURSO_URL) {
  console.warn(
    '[build-ingest] TURSO_LIBRARY_DATABASE_URL is not set; skipping ingest + analysis.\n' +
      '              The deploy will use whatever data is already on Turso\n' +
      '              (or the bundled fallback for local builds without the env var).',
  );
  process.exit(0);
}

const DEFAULT_CHUNK_SIZE = 1000;
function resolveChunkSize() {
  const raw = process.env.INGEST_CHUNK_SIZE;
  if (raw == null || raw === '') return DEFAULT_CHUNK_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.warn(
      `[build-ingest] INGEST_CHUNK_SIZE="${raw}" is not a positive integer; ` +
        `falling back to ${DEFAULT_CHUNK_SIZE}.`,
    );
    return DEFAULT_CHUNK_SIZE;
  }
  return n;
}

/**
 * Spawn a child process, stream its stdout line-by-line to our stdout in
 * real time (no buffering), and capture the trailing SUMMARY line for the
 * orchestrator. stderr is forwarded directly so build logs preserve the
 * relative order of stdout vs stderr where it matters.
 *
 * Switching from spawnSync to async spawn matters: spawnSync only flushes
 * captured stdout after the child exits, so a long-running ingest looked
 * completely silent in the Netlify log for ~18 minutes before the build
 * was killed. Line-by-line streaming surfaces per-page progress as it
 * happens, which is the whole point of the chunked-ingest plan.
 */
function run(cmd, args, label) {
  return new Promise((resolveRun) => {
    console.log(`\n[build-ingest] $ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let lastSummary = null;
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      process.stdout.write(line + '\n');
      if (line.startsWith('SUMMARY ')) {
        try {
          lastSummary = JSON.parse(line.slice('SUMMARY '.length));
        } catch {
          console.warn(`[build-ingest] could not parse SUMMARY line: ${line}`);
        }
      }
    });

    child.on('error', (err) => {
      console.error(`[build-ingest] failed to spawn ${label}: ${err.message}`);
      process.exit(1);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(
          `[build-ingest] ${label} exited with status ${code}; failing build.`,
        );
        process.exit(code ?? 1);
      }
      resolveRun(lastSummary);
    });
  });
}

/**
 * Like `run`, but inherits stdio directly so child output renders correctly in
 * the Netlify log. We don't need to capture stdout for these.
 */
function runStreaming(cmd, args, label, env = process.env) {
  console.log(`\n[build-ingest] $ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[build-ingest] failed to spawn ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(
      `[build-ingest] ${label} exited with status ${result.status}; failing build.`,
    );
    process.exit(result.status ?? 1);
  }
}

async function createLibraryClient() {
  const authToken = process.env.TURSO_LIBRARY_AUTH_TOKEN;
  const config = authToken ? { url: TURSO_URL, authToken } : { url: TURSO_URL };
  if (/^(?:libsql|https?):/i.test(TURSO_URL)) {
    const { createClient } = await import('@libsql/client/http');
    return createClient(config);
  }
  const { createClient } = await import('@libsql/client');
  return createClient(config);
}

async function getSentimentCoverage() {
  const client = await createLibraryClient();
  try {
    const transcribedResult = await client.execute(
      'SELECT COUNT(*) AS n FROM documents WHERE length(trim(transcription)) > 0',
    );
    const sentimentResult = await client.execute('SELECT COUNT(*) AS n FROM document_sentiment');
    return {
      transcribedCount: Number(transcribedResult.rows[0]?.n ?? 0),
      sentimentCount: Number(sentimentResult.rows[0]?.n ?? 0),
    };
  } finally {
    client.close();
  }
}

const chunkSize = resolveChunkSize();
const concurrencyDisplay = process.env.INGEST_CONCURRENCY ?? 'default(8)';
console.log(
  `[build-ingest] LoC chunk size: ${chunkSize} items/build, concurrency: ${concurrencyDisplay}`,
);

const corpusSummaries = [];

corpusSummaries.push(
  await run(
    'npm',
    ['run', 'ingest-loc', '-w', 'server', '--', '--chunk-size', String(chunkSize)],
    'ingest-loc',
  ),
);

const teiFolder = join(repoRoot, 'tei');
if (existsSync(teiFolder)) {
  corpusSummaries.push(
    await run('npm', ['run', 'ingest-tei', '-w', 'server', '--', teiFolder], 'ingest-tei'),
  );
} else {
  console.log(
    `\n[build-ingest] No tei/ folder at ${teiFolder}; skipping TEI ingest.`,
  );
}

const totalWritten = corpusSummaries.reduce((acc, s) => acc + (s?.written ?? 0), 0);
const totalUpdated = corpusSummaries.reduce((acc, s) => acc + (s?.updated ?? 0), 0);
const totalSkipped = corpusSummaries.reduce((acc, s) => acc + (s?.skipped ?? 0), 0);
const totalFailed = corpusSummaries.reduce((acc, s) => acc + (s?.failed ?? 0), 0);
const totalChanged = totalWritten + totalUpdated;

const locSummary = corpusSummaries[0];
const locDone = locSummary?.completed === true;
const locNextPage = locSummary?.nextPage ?? null;

console.log(
  `\n[build-ingest] Ingest done. new=${totalWritten} updated=${totalUpdated} ` +
    `skipped=${totalSkipped} failed=${totalFailed}` +
    (totalChanged === 0 ? ' (no-op rebuild)' : '') +
    (locDone
      ? ' [loc: collection fully ingested]'
      : locNextPage != null
        ? ` [loc: resume page=${locNextPage} on next build]`
        : ''),
);

const topicRepairStart = Date.now();
runStreaming('npm', ['run', 'repair-topic-tags'], 'repair-topic-tags');
const topicRepairMs = Date.now() - topicRepairStart;

const skipAnalysis = process.env.SKIP_ANALYSIS === '1';
const forceAnalysis = process.env.FORCE_ANALYSIS === '1';

const coverage = skipAnalysis
  ? { transcribedCount: 0, sentimentCount: 0 }
  : await getSentimentCoverage();

if (!skipAnalysis) {
  console.log(
    `[build-ingest] Sentiment coverage: ${coverage.sentimentCount}/` +
      `${coverage.transcribedCount} transcribed document(s).`,
  );
}

const analysisDecision = decideSentimentAnalysis({
  skipAnalysis,
  forceAnalysis,
  totalChanged,
  ...coverage,
});

console.log(`[build-ingest] ${analysisDecision.message}`);
if (analysisDecision.shouldRun) {
  runStreaming(
    process.execPath,
    [join(repoRoot, 'scripts', 'ensure-sentiment.mjs')],
    'sentiment',
    {
      ...process.env,
      SENTIMENT_BOOTSTRAP_ALLOW_REMOTE: '1',
      SENTIMENT_BOOTSTRAP_FORCE:
        analysisDecision.reason === 'corpus-changed' || analysisDecision.reason === 'forced'
          ? '1'
          : '',
    },
  );
  console.log(
    '[build-ingest] Sentiment ran this build; deferring TRC metadata ingest to keep the build under Netlify time limits.',
  );
  // Keep document_embeddings in sync when the corpus changed. The script is
  // resilient: it skips (exit 0) if the embedding model can't be loaded, so a
  // blocked model CDN never fails the deploy — semantic search just degrades
  // to lexical until embeddings exist.
  runStreaming(
    process.execPath,
    [join(repoRoot, 'scripts', 'ensure-embeddings.mjs')],
    'embeddings',
    {
      ...process.env,
      EMBEDDINGS_BOOTSTRAP_ALLOW_REMOTE: '1',
      EMBEDDINGS_BOOTSTRAP_FORCE:
        analysisDecision.reason === 'corpus-changed' || analysisDecision.reason === 'forced'
          ? '1'
          : '',
    },
  );
} else {
  const elapsed = Date.now() - buildStart;
  if (topicRepairMs > 60_000 || elapsed > TRC_BUDGET_CUTOFF_MS) {
    console.log(
      '[build-ingest] Deferring TRC metadata ingest to keep the deploy under the Netlify time limit.',
    );
  } else {
    await run(
      'npm',
      ['run', 'ingest-trc', '-w', 'server', '--', '--chunk-size', String(chunkSize)],
      'ingest-trc',
    );
  }
}

console.log('\n[build-ingest] Done. Ingest + analysis complete.');
