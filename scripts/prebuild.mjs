#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, env = process.env) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[prebuild] failed to spawn ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runNpm(args) {
  if (process.platform === 'win32') {
    run('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`]);
    return;
  }
  run('npm', args);
}

run(process.execPath, [join(repoRoot, 'scripts', 'ensure-install.mjs')]);

if (process.env.NETLIFY === 'true') {
  console.log('[prebuild] Netlify build detected; ingest already handled topics and sentiment.');
  process.exit(0);
}

runNpm(['run', 'repair-topic-tags']);
run(process.execPath, [join(repoRoot, 'scripts', 'ensure-sentiment.mjs')]);
run(process.execPath, [join(repoRoot, 'scripts', 'ensure-embeddings.mjs')]);
