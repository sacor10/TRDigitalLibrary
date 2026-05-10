import type { Database as DatabaseT } from 'better-sqlite3';

import { DocumentSchema, type Document } from '@tr/shared';

import { upsertDocument, type ProvenanceContext } from '../db.js';

export const LOC_COLLECTION_SLUG = 'theodore-roosevelt-papers';
export const LOC_SOURCE = 'Library of Congress Theodore Roosevelt Papers';

const LOC_COLLECTION_URL = `https://www.loc.gov/collections/${LOC_COLLECTION_SLUG}/`;
const USER_AGENT =
  'TRDigitalLibrary/0.1 (LoC ingestion; contact via https://github.com/sacor10/trdigitallibrary)';
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_SIZE = 25;

type JsonObject = Record<string, unknown>;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface LocIngestOptions {
  db: DatabaseT | null;
  dryRun?: boolean;
  reset?: boolean;
  limit?: number;
  startPage?: number;
  pageSize?: number;
  editor?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  logger?: Pick<Console, 'log' | 'warn'>;
}

export interface LocIngestResult {
  documentId?: string;
  sourceUrl?: string;
  status: 'ok' | 'error';
  title?: string;
  transcriptionLength?: number;
  error?: string;
}

export interface LocIngestReport {
  scanned: number;
  mapped: number;
  written: number;
  withFullText: number;
  withoutFullText: number;
  failed: number;
  startPage: number;
  pagesFetched: number;
  nextPage: number | null;
  dryRun: boolean;
  results: LocIngestResult[];
}

interface LocCollectionPage {
  results: JsonObject[];
  hasNext: boolean;
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringAt(obj: JsonObject | null, key: string): string | null {
  return obj ? stringValue(obj[key]) : null;
}

function objectAt(obj: JsonObject | null, key: string): JsonObject | null {
  return obj ? asObject(obj[key]) : null;
}

function arrayAt(obj: JsonObject | null, key: string): unknown[] {
  const value = obj?.[key];
  return Array.isArray(value) ? value : [];
}

function stringsAt(obj: JsonObject | null, key: string): string[] {
  return arrayAt(obj, key).flatMap((value) => {
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    const nested = asObject(value);
    if (!nested) return [];
    return Object.keys(nested).filter((k) => k.trim().length > 0);
  });
}

function firstStringAt(obj: JsonObject | null, key: string): string | null {
  return stringsAt(obj, key)[0] ?? stringAt(obj, key);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocUrl(raw: string): string {
  return raw.replace(/^http:\/\//i, 'https://');
}

function locJsonUrl(raw: string): string {
  const url = new URL(normalizeLocUrl(raw));
  url.searchParams.set('fo', 'json');
  return url.toString();
}

function itemIdFromUrl(raw: string): string | null {
  const match = raw.match(/\/item\/([^/?#]+)\/?/i);
  return match?.[1] ?? null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeAuthor(raw: string | null): string {
  if (!raw) return 'Theodore Roosevelt';
  const cleaned = raw.replace(/\b\d{4}-\d{4}\b/g, '').replace(/[.,\s]+$/g, '').trim();
  const roosevelt = cleaned.match(/^roosevelt,\s*theodore/i);
  if (roosevelt) return 'Theodore Roosevelt';
  const comma = cleaned.match(/^([^,]+),\s*(.+)$/);
  if (comma) return `${comma[2]} ${comma[1]}`.trim();
  return cleaned || 'Theodore Roosevelt';
}

function monthNumber(name: string): string {
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const idx = months.indexOf(name.toLowerCase());
  return String(idx + 1).padStart(2, '0');
}

export function normalizeLocDate(raw: string | null): string {
  if (!raw) return '1900-01-01';
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const month = trimmed.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/i,
  );
  if (month) {
    return `${month[3]}-${monthNumber(month[1]!)}-${month[2]!.padStart(2, '0')}`;
  }
  const year = trimmed.match(/\b(\d{4})\b/);
  if (year) return `${year[1]}-01-01`;
  return '1900-01-01';
}

function inferType(item: JsonObject): Document['type'] {
  const nested = objectAt(item, 'item');
  const formatText = [
    ...stringsAt(item, 'original_format'),
    ...stringsAt(item, 'format'),
    ...stringsAt(nested, 'format'),
  ]
    .join(' ')
    .toLowerCase();
  if (formatText.includes('manuscript')) return 'manuscript';

  const text = [
    stringAt(item, 'title'),
    stringAt(nested, 'title'),
    ...stringsAt(item, 'genre'),
    ...stringsAt(nested, 'genre'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/\bdiar(y|ies)\b/.test(text)) return 'diary';
  if (/\b(speech|address)\b/.test(text)) return 'speech';
  if (/\b(article|essay)\b/.test(text)) return 'article';
  if (/\b(autobiography|memoir)\b/.test(text)) return 'autobiography';
  if (/\b(letter|correspondence)\b/.test(text)) return 'letter';
  return 'manuscript';
}

function extractSourceUrl(item: JsonObject): string | null {
  const url = stringAt(item, 'url') ?? stringAt(item, 'id');
  return url ? normalizeLocUrl(url).replace(/\?fo=json$/, '') : null;
}

function extractDocumentId(item: JsonObject): string {
  const number = stringsAt(item, 'number')[0] ?? stringAt(item, 'number');
  const sourceUrl = extractSourceUrl(item);
  const raw = number ?? (sourceUrl ? itemIdFromUrl(sourceUrl) : null) ?? stringAt(item, 'title') ?? 'loc-item';
  return `loc-${slugify(raw)}`;
}

function extractTitle(item: JsonObject): string {
  const nested = objectAt(item, 'item');
  return (
    stringAt(item, 'title') ??
    stringAt(nested, 'title') ??
    extractDocumentId(item).replace(/^loc-/, 'LoC item ')
  );
}

function extractDate(item: JsonObject): string {
  const nested = objectAt(item, 'item');
  return normalizeLocDate(
    stringAt(item, 'date') ??
      firstStringAt(item, 'created_published') ??
      stringAt(nested, 'date') ??
      firstStringAt(nested, 'created_published'),
  );
}

function extractAuthor(item: JsonObject): string {
  const nested = objectAt(item, 'item');
  return normalizeAuthor(
    stringsAt(item, 'contributor_names')[0] ??
      stringsAt(item, 'contributor')[0] ??
      stringsAt(nested, 'contributors')[0] ??
      stringsAt(item, 'contributors')[0] ??
      null,
  );
}

function extractFacsimileUrl(item: JsonObject): string | null {
  const imageUrl = stringsAt(item, 'image_url')[0];
  if (imageUrl) return imageUrl;
  for (const resource of arrayAt(item, 'resources')) {
    const image = stringAt(asObject(resource), 'image');
    if (image) return image;
  }
  return null;
}

export function extractFullTextUrl(item: JsonObject): string | null {
  for (const resource of arrayAt(item, 'resources')) {
    const resourceObj = asObject(resource);
    const fullText = stringAt(resourceObj, 'fulltext_file');
    if (fullText) return normalizeLocUrl(fullText);
  }
  return null;
}

function extractTags(item: JsonObject): string[] {
  const nested = objectAt(item, 'item');
  return unique([
    ...stringsAt(item, 'subject'),
    ...stringsAt(item, 'subject_headings'),
    ...stringsAt(nested, 'subjects'),
    ...stringsAt(item, 'partof'),
    ...stringsAt(item, 'original_format'),
  ]).slice(0, 40);
}

function extractProvenance(item: JsonObject): string {
  const shelf = stringAt(item, 'shelf_id');
  const nested = objectAt(item, 'item');
  const callNumbers = stringsAt(nested, 'call_number');
  const rights = stripHtml(stringsAt(item, 'rights')[0] ?? stringAt(nested, 'rights') ?? '');
  const parts = [
    `Imported from ${LOC_SOURCE}.`,
    shelf ? `Shelf: ${shelf}.` : null,
    callNumbers.length > 0 ? `Call number: ${callNumbers.join('; ')}.` : null,
    rights ? `Rights: ${rights}` : null,
  ];
  return parts.filter(Boolean).join(' ');
}

export function mapLocItemToDocument(
  rawItem: unknown,
  transcription = '',
  transcriptionUrl: string | null = null,
): Document {
  const item = asObject(rawItem);
  if (!item) throw new Error('LoC item response did not include an item object');
  const sourceUrl = extractSourceUrl(item);
  return DocumentSchema.parse({
    id: extractDocumentId(item),
    title: extractTitle(item),
    type: inferType(item),
    date: extractDate(item),
    recipient: null,
    location: null,
    author: extractAuthor(item),
    transcription,
    transcriptionUrl,
    transcriptionFormat: 'plain-text',
    facsimileUrl: extractFacsimileUrl(item),
    iiifManifestUrl: null,
    provenance: extractProvenance(item),
    source: LOC_SOURCE,
    sourceUrl,
    tags: extractTags(item),
    mentions: [],
    teiXml: null,
  });
}

function collectionUrl(page: number, count: number): string {
  const url = new URL(LOC_COLLECTION_URL);
  url.searchParams.set('fo', 'json');
  url.searchParams.set('c', String(count));
  url.searchParams.set('sp', String(page));
  url.searchParams.set('at', 'results,pagination');
  url.searchParams.set('fa', 'online-format:online text');
  return url.toString();
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  accept: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const res = await fetchWithTimeout(fetchImpl, url, 'application/json');
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return (await res.json()) as unknown;
}

async function fetchText(fetchImpl: FetchLike, url: string): Promise<string> {
  const res = await fetchWithTimeout(fetchImpl, url, 'text/plain');
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return (await res.text()).trim();
}

async function fetchCollectionPage(
  fetchImpl: FetchLike,
  page: number,
  pageSize: number,
): Promise<LocCollectionPage> {
  const json = asObject(await fetchJson(fetchImpl, collectionUrl(page, pageSize)));
  if (!json) throw new Error('LoC collection response was not an object');
  const results = arrayAt(json, 'results').flatMap((value) => {
    const result = asObject(value);
    return result ? [result] : [];
  });
  const pagination = objectAt(json, 'pagination');
  return { results, hasNext: Boolean(stringAt(pagination, 'next')) };
}

async function fetchItem(fetchImpl: FetchLike, result: JsonObject): Promise<JsonObject> {
  const rawUrl = stringAt(result, 'id') ?? stringAt(result, 'url');
  if (!rawUrl) throw new Error('LoC result did not include id or url');
  const json = asObject(await fetchJson(fetchImpl, locJsonUrl(rawUrl)));
  const item = objectAt(json, 'item');
  if (!item) throw new Error('LoC item response did not include item');
  return item;
}

export function resetLibraryCorpus(db: DatabaseT): void {
  db.transaction(() => {
    db.prepare('DELETE FROM topic_drift').run();
    db.prepare('DELETE FROM document_topics').run();
    db.prepare('DELETE FROM topics').run();
    db.prepare('DELETE FROM document_sentiment').run();
    db.prepare('DELETE FROM document_field_provenance_history').run();
    db.prepare('DELETE FROM document_field_provenance').run();
    db.prepare('DELETE FROM document_sections').run();
    db.prepare('DELETE FROM documents').run();
    db.prepare("INSERT INTO documents_fts(documents_fts) VALUES ('rebuild')").run();
    db.prepare("INSERT INTO sections_fts(sections_fts) VALUES ('rebuild')").run();
  })();
}

export async function ingestLocCollection(options: LocIngestOptions): Promise<LocIngestReport> {
  const dryRun = options.dryRun ?? false;
  const startPage = options.startPage ?? 1;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;
  const editor = options.editor ?? 'loc-ingest';

  if (!dryRun && !options.db) {
    throw new Error('A database is required unless --dry-run is set');
  }

  if (!dryRun && options.reset && options.db) {
    resetLibraryCorpus(options.db);
    logger.log('Reset existing corpus rows.');
  } else if (dryRun && options.reset) {
    logger.log('Dry run: reset requested, but no database rows were changed.');
  }

  const report: LocIngestReport = {
    scanned: 0,
    mapped: 0,
    written: 0,
    withFullText: 0,
    withoutFullText: 0,
    failed: 0,
    startPage,
    pagesFetched: 0,
    nextPage: startPage,
    dryRun,
    results: [],
  };

  let page = startPage;
  let remaining = options.limit ?? Number.POSITIVE_INFINITY;

  while (remaining > 0) {
    const collection = await fetchCollectionPage(fetchImpl, page, pageSize);
    report.pagesFetched += 1;
    logger.log(`Fetched LoC page ${page} (${collection.results.length} result(s)).`);
    if (collection.results.length === 0) {
      report.nextPage = null;
      break;
    }

    let processedOnPage = 0;
    for (const result of collection.results) {
      if (remaining <= 0) break;
      remaining -= 1;
      processedOnPage += 1;
      report.scanned += 1;

      try {
        const item = await fetchItem(fetchImpl, result);
        const transcriptionUrl = extractFullTextUrl(item);
        let transcription = '';
        if (transcriptionUrl) {
          transcription = await fetchText(fetchImpl, transcriptionUrl);
        }
        const document = mapLocItemToDocument(item, transcription, transcriptionUrl);
        report.mapped += 1;
        if (transcription.trim()) {
          report.withFullText += 1;
        } else {
          report.withoutFullText += 1;
        }

        if (!dryRun && options.db) {
          const ctx: ProvenanceContext = {
            sourceUrl: document.sourceUrl,
            fetchedAt: now().toISOString(),
            editor,
          };
          upsertDocument(options.db, document, ctx);
          report.written += 1;
        }

        const okResult: LocIngestResult = {
          status: 'ok',
          documentId: document.id,
          title: document.title,
          transcriptionLength: document.transcription.length,
        };
        if (document.sourceUrl) okResult.sourceUrl = document.sourceUrl;
        report.results.push(okResult);
        logger.log(
          `  ${dryRun ? 'mapped' : 'ingested'} ${document.id} (${document.transcription.length} chars)`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.failed += 1;
        report.results.push({ status: 'error', error: message });
        logger.warn(`  failed LoC result: ${message}`);
      }
    }

    if (remaining <= 0 && processedOnPage < collection.results.length) {
      report.nextPage = null;
      break;
    }

    if (!collection.hasNext || collection.results.length < pageSize) {
      report.nextPage = null;
      break;
    }
    page += 1;
    report.nextPage = page;
  }

  return report;
}
