#!/usr/bin/env node
/**
 * Idempotent build-time embedding bootstrap. Mirrors ensure-sentiment.mjs:
 * wired into predev/prebuild, keeps document_embeddings in sync with documents.
 *
 * Computes a mean-pooled, L2-normalized sentence embedding per document with a
 * local model (default Xenova/bge-small-en-v1.5, 384-dim) via
 * @xenova/transformers, and stores it as a little-endian Float32 BLOB.
 *
 * Resilient by design: if the model can't be loaded (e.g. the network policy
 * blocks the model CDN and no vendored weights are configured), it logs a
 * warning and exits 0 so the build still succeeds — semantic search then
 * degrades to lexical at query time.
 *
 * Skips on Turso unless EMBEDDINGS_BOOTSTRAP_ALLOW_REMOTE=1.
 *
 * Exit codes:
 *   0 — success, including silent skips and unavailable-model skips
 *   non-zero — genuine error (DB open or migrations failed)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DB_PATH = join(REPO_ROOT, 'data', 'library.db');
const MIGRATIONS_DIR = join(REPO_ROOT, 'server', 'src', 'migrations');

const MODEL = process.env.EMBEDDINGS_MODEL ?? 'Xenova/bge-small-en-v1.5';
const DIM = Number(process.env.EMBEDDINGS_DIM ?? 384);
const CHUNK_CHARS = 2000;
const DEFAULT_BATCH_SIZE = 25;

function log(msg) {
  console.log(`[ensure-embeddings] ${msg}`);
}

function gitSha() {
  try {
    return (
      execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || 'unknown'
    );
  } catch {
    return 'unknown';
  }
}

function modelVersion() {
  return `${gitSha()}:${MODEL}`;
}

function chunkText(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  for (let i = 0; i < clean.length; i += CHUNK_CHARS) chunks.push(clean.slice(i, i + CHUNK_CHARS));
  return chunks;
}

function encodeEmbedding(vec) {
  const arr = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

async function loadExtractor() {
  const transformers = await import('@xenova/transformers');
  const localPath = process.env.EMBEDDINGS_MODEL_PATH;
  if (localPath) {
    transformers.env.allowLocalModels = true;
    transformers.env.localModelPath = localPath;
  }
  return transformers.pipeline('feature-extraction', MODEL);
}

async function embed(extractor, text) {
  const chunks = chunkText(text);
  if (chunks.length === 0) return null;
  const acc = new Float32Array(DIM);
  let count = 0;
  for (const chunk of chunks) {
    const out = await extractor(chunk, { pooling: 'mean', normalize: true });
    const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
    const n = Math.min(DIM, data.length);
    for (let i = 0; i < n; i++) acc[i] += data[i];
    count += 1;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    acc[i] /= count;
    norm += acc[i] * acc[i];
  }
  if (norm > 0) {
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < DIM; i++) acc[i] *= inv;
  }
  return acc;
}

async function runMigrations(client) {
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
  const applied = new Set(
    (
      await client.execute({
        sql: `SELECT id FROM schema_migrations WHERE id IN (${placeholders})`,
        args: files,
      })
    ).rows.map((row) => String(row.id)),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    await client.executeMultiple(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    await client.execute({ sql: 'INSERT INTO schema_migrations (id) VALUES (?)', args: [file] });
  }
}

function resolveBatchSize() {
  const raw = process.env.EMBEDDINGS_BOOTSTRAP_BATCH_SIZE;
  if (raw == null || raw === '') return DEFAULT_BATCH_SIZE;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_BATCH_SIZE;
}

async function main() {
  const configuredUrl = process.env.TURSO_LIBRARY_DATABASE_URL;
  const allowRemote = process.env.EMBEDDINGS_BOOTSTRAP_ALLOW_REMOTE === '1';
  const force = process.env.EMBEDDINGS_BOOTSTRAP_FORCE === '1';
  if (configuredUrl && !allowRemote) {
    log("Turso configured; bootstrap is the build orchestrator's responsibility - skipping");
    return 0;
  }
  if (process.env.SKIP_EMBEDDINGS_BOOTSTRAP === '1') {
    log('SKIP_EMBEDDINGS_BOOTSTRAP=1 — skipping');
    return 0;
  }
  if (!configuredUrl && !existsSync(DB_PATH)) {
    log(`no library DB at ${DB_PATH} — skipping (run \`npm run ingest\` first)`);
    return 0;
  }

  const url = configuredUrl ?? `file:${DB_PATH}`;
  const authToken = process.env.TURSO_LIBRARY_AUTH_TOKEN;
  const config = authToken ? { url, authToken } : { url };
  const { createClient } = /^(?:libsql|https?):/i.test(url)
    ? await import('@libsql/client/http')
    : await import('@libsql/client');
  const client = createClient(config);
  try {
    await runMigrations(client);

    const version = modelVersion();
    const docCount = Number(
      (
        await client.execute(
          'SELECT COUNT(*) AS n FROM documents WHERE length(trim(transcription)) > 0',
        )
      ).rows[0]?.n ?? 0,
    );
    if (docCount === 0) {
      log('no documents to embed; skipping');
      return 0;
    }

    const corpusSql =
      force
        ? 'SELECT id, transcription FROM documents WHERE length(trim(transcription)) > 0 ORDER BY date ASC'
        : `SELECT d.id, d.transcription
             FROM documents d
             LEFT JOIN document_embeddings e
               ON e.document_id = d.id AND e.model_version = @version
            WHERE length(trim(d.transcription)) > 0
              AND e.document_id IS NULL
            ORDER BY d.date ASC`;
    const corpus = await client.execute({ sql: corpusSql, args: force ? {} : { version } });
    if (corpus.rows.length === 0) {
      log(`up to date — embeddings present for all ${docCount} document(s)`);
      return 0;
    }

    let extractor;
    try {
      log(`loading model ${MODEL}…`);
      extractor = await loadExtractor();
    } catch (err) {
      log(
        `model unavailable (${err instanceof Error ? err.message : String(err)}); ` +
          'skipping — semantic search will degrade to lexical until embeddings exist',
      );
      return 0;
    }

    log(`embedding ${corpus.rows.length} document(s)`);
    const computedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const insertSql = `INSERT INTO document_embeddings (document_id, embedding, dim, model_version, computed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
          embedding = excluded.embedding,
          dim = excluded.dim,
          model_version = excluded.model_version,
          computed_at = excluded.computed_at`;

    const batchSize = resolveBatchSize();
    let written = 0;
    let batch = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await client.batch(batch, 'write');
      written += batch.length;
      log(`wrote ${written} embedding row(s)`);
      batch = [];
    };
    for (const row of corpus.rows) {
      const vec = await embed(extractor, String(row.transcription));
      if (!vec) continue;
      batch.push({
        sql: insertSql,
        args: [String(row.id), encodeEmbedding(vec), DIM, version, computedAt],
      });
      if (batch.length >= batchSize) await flush();
    }
    await flush();
    log(`embedded ${corpus.rows.length} document(s), wrote ${written} rows`);
    return 0;
  } finally {
    client.close();
  }
}

const invokedAsEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(
        `[ensure-embeddings] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    });
}
