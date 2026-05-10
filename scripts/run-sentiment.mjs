#!/usr/bin/env node
/**
 * Wrapper for `npm run sentiment`.
 *
 * Invokes `python python/sentiment.py` with any forwarded args. If Python is
 * not on PATH, prints a clear message and exits with code 2 — same shape as
 * `npm run topic-model` / `npm run validate-tei` when their tools are absent.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const script = join(repoRoot, 'python', 'sentiment.py');

const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];

function pickPython() {
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return cmd;
  }
  return null;
}

const python = pickPython();
if (!python) {
  console.error(
    '[sentiment] `python` not found on PATH. Install Python 3.10+ and ' +
      '`pip install -r python/requirements.txt`, then retry. Skipping.',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
const result = spawnSync(python, [script, ...args], {
  stdio: 'inherit',
  cwd: repoRoot,
});

if (result.error) {
  console.error(`[sentiment] failed to invoke ${python}: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);
