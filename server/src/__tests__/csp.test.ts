import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const netlifyConfigPath = path.join(repoRoot, 'netlify.toml');
const clientSourceRoots = [
  path.join(repoRoot, 'client/src'),
  path.join(repoRoot, 'client/index.html'),
  path.join(repoRoot, 'client/vite.config.ts'),
];

const sourceExtensions = new Set(['.html', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

function collectSourceFiles(entry: string): string[] {
  const stat = statSync(entry);
  if (stat.isFile()) {
    return sourceExtensions.has(path.extname(entry)) ? [entry] : [];
  }

  return readdirSync(entry).flatMap((child) => collectSourceFiles(path.join(entry, child)));
}

describe('Content Security Policy', () => {
  it('keeps the production script policy strict', () => {
    const config = readFileSync(netlifyConfigPath, 'utf8');
    const cspMatch = config.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);

    expect(cspMatch?.[1]).toBeDefined();
    const csp = cspMatch![1];

    expect(csp).toContain("script-src 'self' https://accounts.google.com/gsi/client");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('does not introduce string-based JavaScript evaluation in client source', () => {
    const disallowedPatterns = [
      { name: 'eval()', pattern: /\beval\s*\(/ },
      { name: 'new Function()', pattern: /new\s+Function\s*\(/ },
      { name: 'string setTimeout()', pattern: /setTimeout\s*\(\s*['"`]/ },
      { name: 'string setInterval()', pattern: /setInterval\s*\(\s*['"`]/ },
    ];

    const violations = clientSourceRoots
      .flatMap(collectSourceFiles)
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return disallowedPatterns
          .filter(({ pattern }) => pattern.test(source))
          .map(({ name }) => `${path.relative(repoRoot, file)}: ${name}`);
      });

    expect(violations).toEqual([]);
  });
});
