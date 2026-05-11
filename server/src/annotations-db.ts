import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client as LibsqlClient, Config as LibsqlConfig } from '@libsql/client';

const __dirname = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const DEFAULT_LOCAL_URL = `file:${join(__dirname, '..', '..', 'data', 'annotations.db')}`;

export interface OpenAnnotationsDbOptions {
  url?: string;
  authToken?: string;
}

export async function openAnnotationsDb(
  opts: OpenAnnotationsDbOptions = {},
): Promise<LibsqlClient> {
  const url = opts.url ?? process.env.TURSO_DATABASE_URL ?? DEFAULT_LOCAL_URL;
  const authToken = opts.authToken ?? process.env.TURSO_AUTH_TOKEN;

  const client = await createLibsqlClient(url, authToken);
  await runMigrations(client);
  return client;
}

export async function openInMemoryAnnotationsDb(): Promise<LibsqlClient> {
  const client = await createLibsqlClient(':memory:');
  await runMigrations(client);
  return client;
}

async function createLibsqlClient(
  url: string,
  authToken?: string,
): Promise<LibsqlClient> {
  const config: LibsqlConfig = authToken ? { url, authToken } : { url };
  if (/^(?:libsql|https?):/i.test(url)) {
    const { createClient } = await import('@libsql/client/http');
    return createClient(config);
  }
  const { createClient } = await import('@libsql/client');
  return createClient(config);
}

async function runMigrations(client: LibsqlClient): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );

  const migrationsDir = [
    join(__dirname, 'annotations-migrations'),
    join(__dirname, 'server', 'src', 'annotations-migrations'),
    join(process.cwd(), 'server', 'src', 'annotations-migrations'),
  ].find((candidate) => existsSync(candidate));
  if (!migrationsDir) {
    throw new Error('Could not locate annotations migration files');
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) return;

  // Single batched probe instead of one SELECT per file. See server/src/db.ts
  // for the same optimisation on the library DB and the cold-start motivation.
  const placeholders = files.map(() => '?').join(',');
  const appliedResult = await client.execute({
    sql: `SELECT id FROM schema_migrations WHERE id IN (${placeholders})`,
    args: files,
  });
  const applied = new Set(appliedResult.rows.map((row) => String(row.id)));

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    await client.batch(
      [
        ...statements.map((s) => ({ sql: s, args: [] as string[] })),
        { sql: 'INSERT INTO schema_migrations (id) VALUES (?)', args: [file] },
      ],
      'write',
    );
  }
}

export type { LibsqlClient };
