import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { DocumentSchema, type TranscriptionFormat } from '@tr/shared';

import { openDatabase, upsertDocument } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER_AGENT =
  'TRDigitalLibrary/0.1 (educational POC; contact via https://github.com/sacor10/trdigitallibrary)';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_TRANSCRIPTION_CHARS = 12_000;

const SeedDocumentSchema = DocumentSchema.extend({
  transcriptionStartMarker: z.string().min(1).optional(),
  transcriptionEndMarker: z.string().min(1).optional(),
});
const SeedFileSchema = z.array(SeedDocumentSchema);

type SeedDocument = z.infer<typeof SeedDocumentSchema>;

function loadSeedDocuments(): SeedDocument[] {
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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function applyMarkers(
  text: string,
  startMarker?: string,
  endMarker?: string,
): string {
  let out = normalizeText(text);
  if (startMarker) {
    const marker = normalizeText(startMarker);
    const idx = out.indexOf(marker);
    if (idx === -1) {
      throw new Error(`start marker not found: ${startMarker}`);
    }
    out = out.slice(idx);
  }
  if (endMarker) {
    const marker = normalizeText(endMarker);
    const idx = out.indexOf(marker);
    if (idx === -1) {
      throw new Error(`end marker not found: ${endMarker}`);
    }
    out = out.slice(0, idx).trim();
  }
  return out;
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
  markers: Pick<SeedDocument, 'transcriptionStartMarker' | 'transcriptionEndMarker'> = {},
): Promise<string> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const body = await res.text();
  const baseText = format === 'wikisource-html' ? stripHtml(body) : body;
  const text = applyMarkers(
    baseText,
    markers.transcriptionStartMarker,
    markers.transcriptionEndMarker,
  );
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
  const failedIds: string[] = [];
  const emptyIds: string[] = [];

  for (const doc of documents) {
    let transcription = doc.transcription;
    if (doc.transcriptionUrl) {
      try {
        transcription = await fetchTranscription(doc.transcriptionUrl, doc.transcriptionFormat, {
          transcriptionStartMarker: doc.transcriptionStartMarker,
          transcriptionEndMarker: doc.transcriptionEndMarker,
        });
        fetched += 1;
        console.log(`  fetched  ${doc.id}  (${transcription.length} chars)`);
      } catch (err) {
        failed += 1;
        failedIds.push(doc.id);
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  skipped  ${doc.id}  (${message}) — metadata stored, transcription empty`);
      }
    }
    if (transcription.trim().length === 0) {
      emptyIds.push(doc.id);
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

  if (process.env.TR_SEED_STRICT === '1' && (failedIds.length > 0 || emptyIds.length > 0)) {
    throw new Error(
      `Strict seed failed. fetch failures=[${failedIds.join(', ')}] empty transcriptions=[${emptyIds.join(', ')}]`,
    );
  }
}

await seed();
