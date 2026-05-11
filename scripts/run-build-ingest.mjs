#!/usr/bin/env node
/**
 * Build-time ingest + analysis orchestrator.
 *
 * Runs the LoC and TEI ingests against the configured Turso library DB,
 * captures their machine-readable SUMMARY lines, and — only when the
 * corpus actually changed — invokes the Python sidecars (sentiment +
 * topic-model) so the precomputed `topics`, `document_topics`,
 * `topic_drift`, and `document_sentiment` tables stay in sync with the
 * documents table.
 *
 * Behaviour:
 *
 *   - If TURSO_LIBRARY_DATABASE_URL is unset, log a warning and exit 0
 *     so PR previews / forks without Turso secrets do not break.
 *   - Run `npm run ingest-loc -w server -- --limit ${INGEST_CHUNK_SIZE}`
 *     and (if a tei/ folder exists at the repo root)
 *     `npm run ingest-tei -w server -- tei`.
 *   - Each ingest is expected to print a single line of the shape
 *         SUMMARY {"source":"loc","scanned":N,"written":W,...}
 *     We surface this to the build log and aggregate written+updated
 *     across all ingests.
 *   - INGEST_CHUNK_SIZE (default 2000) caps the LoC ingest per build so a
 *     single Netlify build stays well under the 18-minute wall. The
 *     ingest persists a resume cursor in the `ingest_progress` table, so
 *     subsequent builds pick up where this one left off automatically.
 *   - Child stdout is streamed line-by-line to our stdout so per-page
 *     progress shows up in the Netlify log in real time (the previous
 *     spawnSync + buffered-stdout combo hid all progress until the child
 *     exited, which never happened on a timed-out build).
 *   - A non-zero exit from any ingest fails the build LOUDLY (the plan's
 *     explicit requirement).
 *   - "No new content" — written + updated = 0 across both ingests — is
 *     a successful build AND short-circuits the Python analysis pass.
 *     This is the no-op fast path: a rebuild with nothing to do finishes
 *     in seconds, not minutes.
 *   - Otherwise: install Python deps once (pip is cached across builds
 *     via PIP_CACHE_DIR) and run `python python/sentiment.py` followed by
 *     `python python/topic_model.py`. Either Python failure fails the
 *     build loudly. The HuggingFace model cache (HF_HOME) is set in
 *     netlify.toml so the heavy sentence-transformers download only
 *     happens on the first cold build.
 *
 * Local parity: running this script with
 *     TURSO_LIBRARY_DATABASE_URL=file:./data/library.db
 * exercises the exact same gating logic without Turso credentials, so
 * the no-op verification step in the plan is testable locally.
 *
 * Escape hatches (handy for local debugging):
 *   - INGEST_CHUNK_SIZE=<n>       cap LoC ingest at <n> items per build
 *                                (default 2000).
 *   - SKIP_ANALYSIS=1            don't run sentiment / topic-model even
 *                                if the corpus changed.
 *   - SKIP_PIP_INSTALL=1         skip `pip install -r python/requirements.txt`
 *                                (assume the venv is already set up).
 *   - FORCE_ANALYSIS=1           run sentiment + topic-model even if the
 *                                ingests reported a no-op.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const TURSO_URL = process.env.TURSO_LIBRARY_DATABASE_URL;
if (!TURSO_URL) {
  console.warn(
    '[build-ingest] TURSO_LIBRARY_DATABASE_URL is not set; skipping ingest + analysis.\n' +
      '              The deploy will use whatever data is already on Turso\n' +
      '              (or the bundled fallback for local builds without the env var).',
  );
  process.exit(0);
}

const DEFAULT_CHUNK_SIZE = 2000;
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
 * Like `run`, but inherits stdio directly so multi-line / progress-bar output
 * (pip install, sentence-transformers download) renders correctly in the
 * Netlify log. We don't need to capture stdout for these.
 */
function runStreaming(cmd, args, label) {
  console.log(`\n[build-ingest] $ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    env: process.env,
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

/**
 * Pick a Python launcher that exists on this machine. Mirrors the logic in
 * scripts/run-sentiment.mjs / scripts/run-topic-model.mjs so behaviour is
 * consistent between `npm run sentiment` and the build orchestrator.
 */
function pickPython() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return cmd;
  }
  return null;
}

const chunkSize = resolveChunkSize();
console.log(`[build-ingest] LoC chunk size: ${chunkSize} items per build`);

const summaries = [];

summaries.push(
  await run(
    'npm',
    ['run', 'ingest-loc', '-w', 'server', '--', '--chunk-size', String(chunkSize)],
    'ingest-loc',
  ),
);

const teiFolder = join(repoRoot, 'tei');
if (existsSync(teiFolder)) {
  summaries.push(
    await run('npm', ['run', 'ingest-tei', '-w', 'server', '--', teiFolder], 'ingest-tei'),
  );
} else {
  console.log(
    `\n[build-ingest] No tei/ folder at ${teiFolder}; skipping TEI ingest.`,
  );
}

const totalWritten = summaries.reduce((acc, s) => acc + (s?.written ?? 0), 0);
const totalUpdated = summaries.reduce((acc, s) => acc + (s?.updated ?? 0), 0);
const totalSkipped = summaries.reduce((acc, s) => acc + (s?.skipped ?? 0), 0);
const totalFailed = summaries.reduce((acc, s) => acc + (s?.failed ?? 0), 0);
const totalChanged = totalWritten + totalUpdated;

const locSummary = summaries[0];
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

const skipAnalysis = process.env.SKIP_ANALYSIS === '1';
const forceAnalysis = process.env.FORCE_ANALYSIS === '1';

if (skipAnalysis) {
  console.log('[build-ingest] SKIP_ANALYSIS=1; not running sentiment / topic-model.');
  process.exit(0);
}

if (totalChanged === 0 && !forceAnalysis) {
  console.log(
    '[build-ingest] No new corpus rows. Skipping topic-model + sentiment ' +
      '(set FORCE_ANALYSIS=1 to override).',
  );
  process.exit(0);
}

console.log(
  `\n[build-ingest] ${totalChanged} corpus row(s) changed; running sentiment + topic-model.`,
);

const python = pickPython();
if (!python) {
  console.error(
    '[build-ingest] `python` not found on PATH. Install Python 3.10+ and ' +
      'retry, or set SKIP_ANALYSIS=1 to bypass.',
  );
  process.exit(1);
}

if (process.env.SKIP_PIP_INSTALL !== '1') {
  // `python -m pip` is the cross-platform invocation that works whether
  // pip is on PATH as `pip`, `pip3`, or only available as `py -m pip`.
  // PIP_CACHE_DIR is set in netlify.toml so re-builds reuse the wheel cache.
  runStreaming(
    python,
    ['-m', 'pip', 'install', '--quiet', '-r', join(repoRoot, 'python', 'requirements.txt')],
    'pip install',
  );
} else {
  console.log('[build-ingest] SKIP_PIP_INSTALL=1; assuming Python deps are already installed.');
}

runStreaming(python, [join(repoRoot, 'python', 'sentiment.py')], 'sentiment');
runStreaming(python, [join(repoRoot, 'python', 'topic_model.py')], 'topic-model');

console.log('\n[build-ingest] Done. Ingest + analysis complete.');
