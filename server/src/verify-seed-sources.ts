import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { DocumentSchema } from '@tr/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER_AGENT =
  'TRDigitalLibrary/0.1 (seed source verification; contact via https://github.com/sacor10/trdigitallibrary)';
const FETCH_TIMEOUT_MS = 20_000;

const SeedDocumentSchema = DocumentSchema.extend({
  transcriptionStartMarker: z.string().min(1).optional(),
  transcriptionEndMarker: z.string().min(1).optional(),
});
const SeedFileSchema = z.array(SeedDocumentSchema);

type SeedDocument = z.infer<typeof SeedDocumentSchema>;
type UrlField = 'transcriptionUrl' | 'sourceUrl' | 'facsimileUrl' | 'iiifManifestUrl';

const URL_FIELDS: UrlField[] = [
  'transcriptionUrl',
  'sourceUrl',
  'facsimileUrl',
  'iiifManifestUrl',
];

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

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<sup[\s\S]*?<\/sup>/gi, '');
  text = text.replace(/<table[\s\S]*?<\/table>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  return normalizeText(decodeEntities(text));
}

function applyMarkers(text: string, doc: SeedDocument): string {
  let out = normalizeText(text);
  if (doc.transcriptionStartMarker) {
    const marker = normalizeText(doc.transcriptionStartMarker);
    const idx = out.indexOf(marker);
    if (idx === -1) {
      throw new Error(`start marker not found: ${doc.transcriptionStartMarker}`);
    }
    out = out.slice(idx);
  }
  if (doc.transcriptionEndMarker) {
    const marker = normalizeText(doc.transcriptionEndMarker);
    const idx = out.indexOf(marker);
    if (idx === -1) {
      throw new Error(`end marker not found: ${doc.transcriptionEndMarker}`);
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
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, text/plain, image/*, application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyUrl(doc: SeedDocument, field: UrlField): Promise<string | null> {
  const url = doc[field];
  if (!url) return null;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (field === 'facsimileUrl') {
    if (!contentType.toLowerCase().startsWith('image/')) {
      throw new Error(`expected image content-type, got ${contentType || 'none'}`);
    }
    return `${res.status} ${contentType}`;
  }

  const body = await res.text();
  if (field === 'transcriptionUrl') {
    const baseText = doc.transcriptionFormat === 'wikisource-html' ? stripHtml(body) : body;
    const text = applyMarkers(baseText, doc);
    if (text.trim().length === 0) {
      throw new Error('transcription is empty after cleanup');
    }
    return `${res.status} ${text.length} chars`;
  }

  return `${res.status} ${contentType || 'unknown content-type'}`;
}

async function main(): Promise<void> {
  const documents = loadSeedDocuments();
  const failures: string[] = [];

  for (const doc of documents) {
    for (const field of URL_FIELDS) {
      try {
        const result = await verifyUrl(doc, field);
        if (result) {
          console.log(`  ok       ${doc.id}.${field}  ${result}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${doc.id}.${field}: ${message}`);
        console.warn(`  failed   ${doc.id}.${field}  ${message}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(`Seed source verification failed:\n${failures.join('\n')}`);
  }

  console.log(`\nVerified seed URLs for ${documents.length} document(s).`);
}

await main();
