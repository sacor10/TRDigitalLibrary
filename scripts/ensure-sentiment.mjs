#!/usr/bin/env node
/**
 * Idempotent JS-only sentiment bootstrap. Wired into `predev` so every
 * `npm run dev` keeps `document_sentiment` in sync with `documents` without
 * shelling to Python.
 *
 * Skips on Turso (build orchestrator owns that path) and when there's nothing
 * to score. Mirrors the algorithm in `python/sentiment.py`:
 *   - sentence split with the same fallback regex
 *   - character-length-weighted aggregation of per-sentence compound/pos/neu/neg
 *   - DELETE-then-INSERT in a single libsql write batch
 *
 * Exit codes:
 *   0 — success, including silent skips
 *   non-zero — genuine error (DB open or migrations failed)
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DB_PATH = join(REPO_ROOT, 'data', 'library.db');
const MIGRATIONS_DIR = join(REPO_ROOT, 'server', 'src', 'migrations');

const POSITIVE_THRESHOLD = 0.05;
const NEGATIVE_THRESHOLD = -0.05;

// Same fallback splitter as python/sentiment.py:43. Lookbehind is supported by
// every Node version this project targets.
const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z"'(])|\n{2,}/;

function log(msg) {
  console.log(`[ensure-sentiment] ${msg}`);
}

export function splitSentences(text) {
  const cleaned = text.trim();
  if (!cleaned) return [];
  return cleaned
    .split(SENTENCE_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function scoreDocument(analyzer, text) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) {
    return { polarity: 0, pos: 0, neu: 1, neg: 0, sentenceCount: 0 };
  }
  let totalChars = 0;
  let compound = 0;
  let pos = 0;
  let neu = 0;
  let neg = 0;
  for (const sent of sentences) {
    const scores = analyzer.polarity_scores(sent);
    const weight = Math.max(1, sent.length);
    totalChars += weight;
    compound += scores.compound * weight;
    pos += scores.pos * weight;
    neu += scores.neu * weight;
    neg += scores.neg * weight;
  }
  return {
    polarity: compound / totalChars,
    pos: pos / totalChars,
    neu: neu / totalChars,
    neg: neg / totalChars,
    sentenceCount: sentences.length,
  };
}

export function labelFor(polarity) {
  if (polarity >= POSITIVE_THRESHOLD) return 'positive';
  if (polarity <= NEGATIVE_THRESHOLD) return 'negative';
  return 'neutral';
}

function gitSha() {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function modelVersion() {
  let version = 'unknown';
  try {
    version = require('vader-sentiment/package.json').version || 'unknown';
  } catch {
    /* keep 'unknown' */
  }
  return `${gitSha()}:vader-sentiment@${version}`;
}

async function runMigrations(client) {
  // Same shape as server/src/db.ts:runMigrations (single CREATE, batched probe,
  // per-file executeMultiple). Embedded here so the script can run from .mjs
  // without a tsx loader; the migrations table is the source of truth so any
  // drift between runners is detectable.
  await client.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Could not locate library migrations at ${MIGRATIONS_DIR}`);
  }
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) return;
  const placeholders = files.map(() => '?').join(',');
  const appliedResult = await client.execute({
    sql: `SELECT id FROM schema_migrations WHERE id IN (${placeholders})`,
    args: files,
  });
  const applied = new Set(appliedResult.rows.map((row) => String(row.id)));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await client.executeMultiple(sql);
    await client.execute({
      sql: 'INSERT INTO schema_migrations (id) VALUES (?)',
      args: [file],
    });
  }
}

async function main() {
  if (process.env.TURSO_LIBRARY_DATABASE_URL) {
    log("Turso configured; bootstrap is the build orchestrator's responsibility — skipping");
    return 0;
  }
  if (process.env.SKIP_SENTIMENT_BOOTSTRAP === '1') {
    log('SKIP_SENTIMENT_BOOTSTRAP=1 — skipping');
    return 0;
  }
  if (!existsSync(DB_PATH)) {
    log(`no library DB at ${DB_PATH} — skipping (run \`npm run ingest\` first)`);
    return 0;
  }

  const { createClient } = await import('@libsql/client');
  const client = createClient({ url: `file:${DB_PATH}` });
  try {
    await runMigrations(client);

    const docCountResult = await client.execute(
      'SELECT COUNT(*) AS n FROM documents WHERE length(trim(transcription)) > 0',
    );
    const docCount = Number(docCountResult.rows[0]?.n ?? 0);
    if (docCount === 0) {
      log('no documents to score; skipping');
      return 0;
    }

    const sentCountResult = await client.execute('SELECT COUNT(*) AS n FROM document_sentiment');
    const sentCount = Number(sentCountResult.rows[0]?.n ?? 0);
    if (sentCount === docCount) {
      log(`up to date — ${docCount} document(s) already scored`);
      return 0;
    }

    const corpus = await client.execute(
      'SELECT id, transcription FROM documents WHERE length(trim(transcription)) > 0 ORDER BY date ASC',
    );

    const { SentimentIntensityAnalyzer } = require('vader-sentiment');
    log(`scoring ${corpus.rows.length} document(s) with VADER`);

    const version = modelVersion();
    const computedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const stmts = [{ sql: 'DELETE FROM document_sentiment', args: [] }];
    for (const row of corpus.rows) {
      const id = String(row.id);
      const text = String(row.transcription);
      const s = scoreDocument(SentimentIntensityAnalyzer, text);
      const label = labelFor(s.polarity);
      stmts.push({
        sql: `INSERT INTO document_sentiment
                (document_id, polarity, pos, neu, neg, label, sentence_count, computed_at, model_version)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, s.polarity, s.pos, s.neu, s.neg, label, s.sentenceCount, computedAt, version],
      });
    }
    await client.batch(stmts, 'write');

    const written = stmts.length - 1;
    log(`scored ${corpus.rows.length} document(s), wrote ${written} rows`);
    return 0;
  } finally {
    client.close();
  }
}

// Only run when invoked as the entry point. Imports (e.g. the parity test)
// get the helpers above without running the DB bootstrap.
const invokedAsEntry =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedAsEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[ensure-sentiment] failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
