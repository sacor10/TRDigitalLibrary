#!/usr/bin/env node
/**
 * Build-time ingest orchestrator.
 *
 * Runs the LoC and TEI ingests against the configured Turso library DB,
 * captures their machine-readable SUMMARY lines, and exits 0 if there is
 * nothing new (so a no-op rebuild is a successful build).
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
 *     explicit requirement). "No new content" — written = updated = 0
 *     across both ingests — is a successful build.
 *
 * Commit 8 will extend this script with a conditional Python analysis pass
 * (topic-model + sentiment) that runs only when an ingest reports new or
 * updated rows.
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
    '[build-ingest] TURSO_LIBRARY_DATABASE_URL is not set; skipping ingest.\n' +
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
  `\n[build-ingest] Done. new=${totalWritten} updated=${totalUpdated} ` +
    `skipped=${totalSkipped} failed=${totalFailed}` +
    (totalChanged === 0 ? ' (no-op rebuild)' : ''),
);
