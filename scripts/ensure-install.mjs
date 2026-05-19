#!/usr/bin/env node
/**
 * Bootstraps workspace dependencies before any npm script that needs them.
 *
 * Idempotent: stat-checks node_modules vs package-lock.json so a fresh clone
 * installs once and subsequent runs are a no-op. Wired in via the root
 * predev / prebuild / pretest / prelint hooks so contributors never need to
 * run `npm install` manually.
 */

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(root, 'node_modules');
const lockPath = path.join(root, 'package-lock.json');
const installedLockPath = path.join(modulesDir, '.package-lock.json');

function needsInstall() {
  if (!existsSync(modulesDir)) return true;
  if (!existsSync(lockPath)) return false;
  if (!existsSync(installedLockPath)) return true;
  return statSync(lockPath).mtimeMs > statSync(installedLockPath).mtimeMs;
}

if (!needsInstall()) {
  process.exit(0);
}

console.log('[ensure-install] node_modules missing or stale — running npm install...');
const isWindows = process.platform === 'win32';
const result = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
  cwd: root,
  stdio: 'inherit',
  shell: isWindows,
});
process.exit(result.status ?? 1);
