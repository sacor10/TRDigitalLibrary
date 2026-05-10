import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { DocumentSchema, type Document, type TranscriptionFormat } from '@tr/shared';

import { openDatabase, upsertDocument } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER_AGENT =
  'TRDigitalLibrary/0.1 (educational POC; contact via https://github.com/sacor10/trdigitallibrary)';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TRANSCRIPTION_CHARS = 12_000;

const SeedFileSchema = z.array(DocumentSchema);

function loadSeedDocuments(): Document[] {
  const seedPath = join(__dirname, '..', '..', 'data', 'seed.json');
  const raw = readFileSync(seedPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return SeedFileSchema.parse(parsed);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function stripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<sup[\s\S]*?<\/sup>/gi, '');
  text = text.replace(/<table[\s\S]*?<\/table>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, text/plain' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTranscription(
  url: string,
  format: TranscriptionFormat,
): Promise<string> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = await res.text();
  const text = format === 'wikisource-html' ? stripHtml(body) : body;
  return text.slice(0, MAX_TRANSCRIPTION_CHARS);
}

async function seed(): Promise<void> {
  const documents = loadSeedDocuments();
  const dbPath = join(__dirname, '..', '..', 'data', 'library.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);

  const editor = process.env.TR_EDITOR ?? 'seed';

  let fetched = 0;
  let failed = 0;

  for (const doc of documents) {
    let transcription = doc.transcription;
    if (doc.transcriptionUrl) {
      try {
        transcription = await fetchTranscription(doc.transcriptionUrl, doc.transcriptionFormat);
        fetched += 1;
        console.log(`  fetched  ${doc.id}  (${transcription.length} chars)`);
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  skipped  ${doc.id}  (${message}) — metadata stored, transcription empty`);
      }
    }
    upsertDocument(
      db,
      { ...doc, transcription },
      {
        sourceUrl: doc.sourceUrl,
        fetchedAt: new Date().toISOString(),
        editor,
      },
    );
  }

  const count = (db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number }).c;
  console.log(
    `\nSeeded ${count} documents into ${dbPath}.  fetched=${fetched}  failed=${failed}`,
  );

  // Make the on-disk file self-contained so deploys / readonly opens don't
  // need -wal / -shm sidecars. Truncate-checkpoint flushes WAL into the main
  // DB, and switching journal_mode to DELETE removes the sidecar files
  // entirely. Without this, the bundled library.db ends up missing rows that
  // are still in the (un-bundled) WAL file, causing 500s in the Netlify
  // function with "no such table: documents".
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.close();
}

await seed();
