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
 *   - Run `npm run ingest-loc -w server` and (if a tei/ folder exists at
 *     the repo root) `npm run ingest-tei -w server -- tei`.
 *   - Each ingest is expected to print a single line of the shape
 *         SUMMARY {"source":"loc","scanned":N,"written":W,...}
 *     We surface this to the build log and aggregate written+updated
 *     across all ingests.
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
 *   - SKIP_ANALYSIS=1            don't run sentiment / topic-model even
 *                                if the corpus changed.
 *   - SKIP_PIP_INSTALL=1         skip `pip install -r python/requirements.txt`
 *                                (assume the venv is already set up).
 *   - FORCE_ANALYSIS=1           run sentiment + topic-model even if the
 *                                ingests reported a no-op.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

/**
 * Run a child process, stream its stdout to our stdout AND capture it so we
 * can parse the trailing SUMMARY line. stderr is forwarded directly so build
 * logs preserve the order of stdout vs stderr where it matters.
 */
function run(cmd, args, label) {
  console.log(`\n[build-ingest] $ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.error) {
    console.error(`[build-ingest] failed to spawn ${label}: ${result.error.message}`);
    process.exit(1);
  }
  const stdout = result.stdout ?? '';
  process.stdout.write(stdout);
  if (result.status !== 0) {
    console.error(
      `[build-ingest] ${label} exited with status ${result.status}; failing build.`,
    );
    process.exit(result.status ?? 1);
  }
  return parseSummary(stdout);
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

function parseSummary(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line && line.startsWith('SUMMARY ')) {
      try {
        return JSON.parse(line.slice('SUMMARY '.length));
      } catch (err) {
        console.warn(`[build-ingest] could not parse SUMMARY line: ${line}`);
        return null;
      }
    }
  }
  return null;
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

const summaries = [];

summaries.push(run('npm', ['run', 'ingest-loc', '-w', 'server'], 'ingest-loc'));

const teiFolder = join(repoRoot, 'tei');
if (existsSync(teiFolder)) {
  summaries.push(
    run('npm', ['run', 'ingest-tei', '-w', 'server', '--', teiFolder], 'ingest-tei'),
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

console.log(
  `\n[build-ingest] Ingest done. new=${totalWritten} updated=${totalUpdated} ` +
    `skipped=${totalSkipped} failed=${totalFailed}` +
    (totalChanged === 0 ? ' (no-op rebuild)' : ''),
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
