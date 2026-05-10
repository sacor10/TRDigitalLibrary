import { DocumentSchema, type Document } from '@tr/shared';

import { documentExists, upsertDocument, type LibsqlClient, type ProvenanceContext } from '../db.js';

export const LOC_COLLECTION_SLUG = 'theodore-roosevelt-papers';
export const LOC_SOURCE = 'Library of Congress Theodore Roosevelt Papers';

const LOC_COLLECTION_URL = `https://www.loc.gov/collections/${LOC_COLLECTION_SLUG}/`;
const USER_AGENT =
  'TRDigitalLibrary/0.1 (LoC ingestion; contact via https://github.com/sacor10/trdigitallibrary)';

// Per-stage timeouts: collection-page + item JSON are usually small, but
// fulltext transcription files can be several MB and were tripping the
// previous shared 30s timeout under load.
const COLLECTION_PAGE_TIMEOUT_MS = 30_000;
const ITEM_TIMEOUT_MS = 30_000;
const FULLTEXT_TIMEOUT_MS = 60_000;

const MAX_FETCH_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;        // backoff schedule: 1s, 2s, 4s (+jitter)
const MAX_RETRY_AFTER_MS = 30_000;    // cap honoring server Retry-After
const DEFAULT_PAGE_SIZE = 25;

type JsonObject = Record<string, unknown>;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type Logger = Pick<Console, 'log' | 'warn' | 'error'>;

export type FetchStage = 'collection-page' | 'item' | 'fulltext';

interface StageConfig {
  stage: FetchStage;
  timeoutMs: number;
  accept: string;
}

const STAGE_CONFIG: Record<FetchStage, StageConfig> = {
  'collection-page': {
    stage: 'collection-page',
    timeoutMs: COLLECTION_PAGE_TIMEOUT_MS,
    accept: 'application/json',
  },
  item: { stage: 'item', timeoutMs: ITEM_TIMEOUT_MS, accept: 'application/json' },
  fulltext: { stage: 'fulltext', timeoutMs: FULLTEXT_TIMEOUT_MS, accept: 'text/plain' },
};

export interface LocFetchErrorInfo {
  stage: FetchStage;
  url: string;
  /** Predicted (collection-page) or known document id when available. */
  documentId: string | null;
  /** Final attempt count, 1..MAX_FETCH_ATTEMPTS. */
  attempts: number;
  errorName: string;
  errorMessage: string;
  /** String(err.cause) when present — undici exposes UND_ERR_* here. */
  cause?: string;
  httpStatus?: number;
  httpStatusText?: string;
  /** Was the *final* error classified as retryable (i.e. retries exhausted)? */
  retryable: boolean;
}

export class LocFetchError extends Error {
  readonly info: LocFetchErrorInfo;
  constructor(info: LocFetchErrorInfo, cause?: unknown) {
    super(
      `[${info.stage}] ${info.errorName}: ${info.errorMessage} ` +
        `(url=${info.url} attempts=${info.attempts})`,
    );
    this.name = 'LocFetchError';
    this.info = info;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface LocIngestOptions {
  db: LibsqlClient | null;
  dryRun?: boolean;
  reset?: boolean;
  /**
   * When `true`, bypass the fast no-op SELECT and re-fetch every item from
   * LoC even if it already exists in the database. The upsert is still
   * idempotent under `skip-if-exists` semantics, so this primarily exists
   * for tests; in production prefer `--reset` (full wipe) for forced
   * re-ingestion.
   */
  force?: boolean;
  limit?: number;
  startPage?: number;
  pageSize?: number;
  editor?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  logger?: Logger;
  /**
   * Override the backoff sleeper. Tests inject a no-op to avoid waiting through
   * real 1s/2s/4s delays; production uses the default setTimeout-based sleep.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface LocIngestResult {
  documentId?: string;
  sourceUrl?: string;
  status: 'ok' | 'skipped' | 'error';
  title?: string;
  transcriptionLength?: number;
  /** Human-readable error summary (one line, key=value pairs for grep). */
  error?: string;
  /** Structured error context when the failure came from a fetch. */
  errorInfo?: LocFetchErrorInfo;
}

export interface LocIngestReport {
  scanned: number;
  mapped: number;
  written: number;
  /** Items skipped because they were already present in the DB. */
  skipped: number;
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

/**
 * Cheaply predict the `documents.id` we'd assign to a collection-page result
 * BEFORE fetching the (much larger) item details JSON. Used by the fast no-op
 * check in `ingestLocCollection` to skip already-ingested rows without paying
 * for the item fetch + full-text download.
 *
 * extractDocumentId() is the source of truth on the full item; this helper
 * mirrors the same precedence chain using only the fields available on a
 * collection page (id/url/title). For LoC TR papers the URL slug equals the
 * `number` field, so the predicted id matches the eventual id; if a future
 * LoC change ever drifts the two, the predicted id simply won't match
 * anything in the DB and we'll fall through to the full fetch + upsert,
 * which is correct (just no faster than today's behaviour).
 */
export function predictDocumentIdFromCollectionResult(result: JsonObject): string | null {
  const rawUrl = stringAt(result, 'url') ?? stringAt(result, 'id');
  if (rawUrl) {
    const itemId = itemIdFromUrl(normalizeLocUrl(rawUrl));
    if (itemId) return `loc-${slugify(itemId)}`;
  }
  const title = stringAt(result, 'title');
  if (title) return `loc-${slugify(title)}`;
  return null;
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
  stage: StageConfig,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), stage.timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: stage.accept },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  // undici surfaces network failures as TypeError('fetch failed') with the
  // real reason on .cause (UND_ERR_*, ECONNRESET, etc.).
  if (err.name === 'TypeError' && /fetch/i.test(err.message)) return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    if (
      code &&
      (code.startsWith('UND_ERR_') ||
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN')
    ) {
      return true;
    }
    if (/terminated|socket hang up|aborted/i.test(cause.message)) return true;
  }
  return /terminated|aborted|network/i.test(err.message);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) {
    return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
  }
  return null;
}

function backoffMs(attempt: number): number {
  // attempt is 1-indexed; wait BEFORE the next attempt.
  // attempt=1 -> 1s, attempt=2 -> 2s, attempt=3 -> 4s (won't normally fire).
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(err: unknown): { name: string; message: string; cause?: string } {
  const e = err instanceof Error ? err : new Error(String(err));
  const causeRaw = (e as { cause?: unknown }).cause;
  const cause =
    causeRaw === undefined
      ? undefined
      : causeRaw instanceof Error
        ? `${causeRaw.name}: ${causeRaw.message}` +
          ((causeRaw as { code?: string }).code ? ` (code=${(causeRaw as { code?: string }).code})` : '')
        : String(causeRaw);
  const out: { name: string; message: string; cause?: string } = { name: e.name, message: e.message };
  if (cause !== undefined) out.cause = cause;
  return out;
}

interface RetryDeps {
  fetchImpl: FetchLike;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
  /** Best-known document id for log context; null when unknown. */
  documentId: string | null;
}

async function fetchWithRetry(
  deps: RetryDeps,
  url: string,
  stage: FetchStage,
): Promise<Response> {
  const cfg = STAGE_CONFIG[stage];
  const docLabel = deps.documentId ?? 'unknown';
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    let res: Response | null = null;
    try {
      res = await fetchWithTimeout(deps.fetchImpl, url, cfg);
    } catch (err) {
      const retryable = isRetryableNetworkError(err);
      if (!retryable || attempt === MAX_FETCH_ATTEMPTS) {
        const d = describeError(err);
        throw new LocFetchError(
          {
            stage,
            url,
            documentId: deps.documentId,
            attempts: attempt,
            errorName: d.name,
            errorMessage: d.message,
            ...(d.cause !== undefined ? { cause: d.cause } : {}),
            retryable,
          },
          err,
        );
      }
      const wait = backoffMs(attempt);
      const d = describeError(err);
      deps.logger.log(
        `[ingest-loc] retry ${stage} attempt ${attempt}/${MAX_FETCH_ATTEMPTS} after ${wait}ms ` +
          `(error=${d.name}: ${d.message}${d.cause ? ` cause=${d.cause}` : ''} ` +
          `url=${url} docId=${docLabel})`,
      );
      await deps.sleep(wait);
      continue;
    }

    if (res.ok) return res;

    // Drain the body so the underlying socket can be reused.
    try {
      await res.text();
    } catch {
      /* ignore */
    }

    const retryable = isRetryableStatus(res.status);
    if (!retryable || attempt === MAX_FETCH_ATTEMPTS) {
      throw new LocFetchError({
        stage,
        url,
        documentId: deps.documentId,
        attempts: attempt,
        errorName: 'HttpError',
        errorMessage: `HTTP ${res.status} ${res.statusText}`,
        httpStatus: res.status,
        httpStatusText: res.statusText,
        retryable,
      });
    }
    const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
    const wait = retryAfter ?? backoffMs(attempt);
    deps.logger.log(
      `[ingest-loc] retry ${stage} attempt ${attempt}/${MAX_FETCH_ATTEMPTS} after ${wait}ms ` +
        `(status=${res.status} ${res.statusText} url=${url} docId=${docLabel})`,
    );
    await deps.sleep(wait);
  }
  // Unreachable: every iteration either returns or throws.
  throw new Error('fetchWithRetry exited loop without resolution');
}

async function fetchJson(deps: RetryDeps, url: string, stage: FetchStage): Promise<unknown> {
  const res = await fetchWithRetry(deps, url, stage);
  return (await res.json()) as unknown;
}

async function fetchText(deps: RetryDeps, url: string, stage: FetchStage): Promise<string> {
  const res = await fetchWithRetry(deps, url, stage);
  return (await res.text()).trim();
}

async function fetchCollectionPage(
  deps: RetryDeps,
  page: number,
  pageSize: number,
): Promise<LocCollectionPage> {
  const json = asObject(await fetchJson(deps, collectionUrl(page, pageSize), 'collection-page'));
  if (!json) throw new Error('LoC collection response was not an object');
  const results = arrayAt(json, 'results').flatMap((value) => {
    const result = asObject(value);
    return result ? [result] : [];
  });
  const pagination = objectAt(json, 'pagination');
  return { results, hasNext: Boolean(stringAt(pagination, 'next')) };
}

async function fetchItem(deps: RetryDeps, result: JsonObject): Promise<JsonObject> {
  const rawUrl = stringAt(result, 'id') ?? stringAt(result, 'url');
  if (!rawUrl) throw new Error('LoC result did not include id or url');
  const json = asObject(await fetchJson(deps, locJsonUrl(rawUrl), 'item'));
  const item = objectAt(json, 'item');
  if (!item) throw new Error('LoC item response did not include item');
  return item;
}

export async function resetLibraryCorpus(db: LibsqlClient): Promise<void> {
  await db.batch(
    [
      'DELETE FROM topic_drift',
      'DELETE FROM document_topics',
      'DELETE FROM topics',
      'DELETE FROM document_sentiment',
      'DELETE FROM document_field_provenance_history',
      'DELETE FROM document_field_provenance',
      'DELETE FROM document_sections',
      'DELETE FROM documents',
      "INSERT INTO documents_fts(documents_fts) VALUES ('rebuild')",
      "INSERT INTO sections_fts(sections_fts) VALUES ('rebuild')",
    ],
    'write',
  );
}

export async function ingestLocCollection(options: LocIngestOptions): Promise<LocIngestReport> {
  const dryRun = options.dryRun ?? false;
  const startPage = options.startPage ?? 1;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const logger: Logger = options.logger ?? console;
  const sleep = options.sleep ?? defaultSleep;
  const editor = options.editor ?? 'loc-ingest';

  const makeDeps = (documentId: string | null): RetryDeps => ({
    fetchImpl,
    logger,
    sleep,
    documentId,
  });

  if (!dryRun && !options.db) {
    throw new Error('A database is required unless --dry-run is set');
  }

  if (!dryRun && options.reset && options.db) {
    await resetLibraryCorpus(options.db);
    logger.log('Reset existing corpus rows.');
  } else if (dryRun && options.reset) {
    logger.log('Dry run: reset requested, but no database rows were changed.');
  }

  const report: LocIngestReport = {
    scanned: 0,
    mapped: 0,
    written: 0,
    skipped: 0,
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
    const collection = await fetchCollectionPage(makeDeps(null), page, pageSize);
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

      // Predict the document id from the collection-page result so retry +
      // error logs carry a stable, grep-able identifier even when the item
      // fetch itself fails.
      const predictedId = predictDocumentIdFromCollectionResult(result);

      try {
        // Fast no-op: predict the document id from the collection-page result
        // alone and skip the (expensive) item-details fetch + full-text
        // download if it's already in the DB. `--force` bypasses the check;
        // `--reset` already wiped the DB so nothing will exist to skip.
        if (!options.force && options.db) {
          if (predictedId && (await documentExists(options.db, predictedId))) {
            report.skipped += 1;
            const skippedResult: LocIngestResult = {
              status: 'skipped',
              documentId: predictedId,
            };
            const sourceUrl = stringAt(result, 'url');
            if (sourceUrl) skippedResult.sourceUrl = sourceUrl;
            const title = stringAt(result, 'title');
            if (title) skippedResult.title = title;
            report.results.push(skippedResult);
            logger.log(`  skipped ${predictedId} (already in DB)`);
            continue;
          }
        }

        const item = await fetchItem(makeDeps(predictedId), result);
        const transcriptionUrl = extractFullTextUrl(item);
        let transcription = '';
        if (transcriptionUrl) {
          transcription = await fetchText(makeDeps(predictedId), transcriptionUrl, 'fulltext');
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
          // skip-if-exists: belt-and-braces against TOCTOU between the
          // documentExists check above and the INSERT here. Without --force
          // we never want to overwrite an already-ingested LoC row from a
          // build-time re-ingest; corrections should go through the
          // /api/documents PATCH path which records provenance history.
          await upsertDocument(options.db, document, ctx, { mode: 'skip-if-exists' });
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
        report.failed += 1;
        if (err instanceof LocFetchError) {
          const info = err.info;
          const summary =
            `[ingest-loc] failed LoC result stage=${info.stage} ` +
            `docId=${info.documentId ?? 'unknown'} url=${info.url} ` +
            `attempts=${info.attempts} error=${info.errorName}: ${info.errorMessage}` +
            (info.cause ? ` cause=${info.cause}` : '') +
            (info.httpStatus != null
              ? ` http=${info.httpStatus} ${info.httpStatusText ?? ''}`.trimEnd()
              : '');
          logger.warn(summary);
          const errResult: LocIngestResult = {
            status: 'error',
            error: summary,
            errorInfo: info,
          };
          if (info.documentId) errResult.documentId = info.documentId;
          report.results.push(errResult);
        } else {
          const d = describeError(err);
          const summary =
            `[ingest-loc] failed LoC result stage=post-fetch ` +
            `docId=${predictedId ?? 'unknown'} error=${d.name}: ${d.message}` +
            (d.cause ? ` cause=${d.cause}` : '');
          logger.warn(summary);
          const errResult: LocIngestResult = { status: 'error', error: summary };
          if (predictedId) errResult.documentId = predictedId;
          report.results.push(errResult);
        }
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
