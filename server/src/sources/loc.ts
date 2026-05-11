import { DocumentSchema, type Document } from '@tr/shared';

import {
  documentExists,
  upsertDocumentsBatch,
  type LibsqlClient,
  type ProvenanceContext,
} from '../db.js';

export const LOC_COLLECTION_SLUG = 'theodore-roosevelt-papers';
export const LOC_SOURCE = 'Library of Congress Theodore Roosevelt Papers';

const LOC_COLLECTION_URL = `https://www.loc.gov/collections/${LOC_COLLECTION_SLUG}/`;
const USER_AGENT =
  'TRDigitalLibrary/0.1 (LoC ingestion; contact via https://github.com/sacor10/trdigitallibrary)';
const LOC_DATE_OVERRIDES_BY_DOCUMENT_ID: Record<string, string> = {
  // LoC item mss382990001 spans pre-Roosevelt related material, but the
  // earliest TR-authored work in the range is the 1877 Summer Birds pamphlet.
  'loc-mss382990001': '1877-01-01',
};

// Per-stage timeouts: collection-page + item JSON are usually small, but
// fulltext transcription files can be several MB and were tripping the
// previous shared 30s timeout under load.
const COLLECTION_PAGE_TIMEOUT_MS = 30_000;
const ITEM_TIMEOUT_MS = 30_000;
const FULLTEXT_TIMEOUT_MS = 60_000;

const MAX_FETCH_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1_000;        // backoff schedule: 1s, 2s, 4s, 8s, 16s (+jitter)
const MAX_RETRY_AFTER_MS = 120_000;   // cap honoring server Retry-After
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
// Defensive cap on a single response body. Fulltext transcriptions are
// typically a few MB; anything substantially larger likely indicates an
// unexpected upstream response and we'd rather fail loudly than OOM the
// Netlify build container.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

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
  /**
   * When true, and `startPage` is left at the default, read the resume
   * cursor from `ingest_progress` and pick up from there. If the cursor is
   * marked completed, return a zeroed report without fetching anything.
   * Explicit `startPage` overrides the cursor.
   */
  autoResume?: boolean;
  /**
   * Maximum number of LoC items processed concurrently within a single
   * collection page. Bounded so we don't overwhelm LoC's rate limits or
   * the libsql client pool. Defaults to 8.
   */
  concurrency?: number;
  /**
   * How often to emit a progress heartbeat line during the per-page item
   * fetch phase. Defaults to 5_000 ms (5 s). Tests pass a very large value
   * (or omit it — pages resolve before the first tick fires).
   */
  heartbeatIntervalMs?: number;
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
  /** True once the LoC collection has been walked end-to-end. */
  completed: boolean;
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

function isoDateFromParts(year: string, month = '01', day = '01'): string {
  const safeMonth = month === '00' ? '01' : month;
  const safeDay = day === '00' ? '01' : day;
  return `${year}-${safeMonth}-${safeDay}`;
}

export function normalizeLocDate(raw: string | null): string {
  if (!raw) return '1900-01-01';
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return isoDateFromParts(iso[1]!, iso[2]!, iso[3]!);
  const isoMonth = trimmed.match(/^(\d{4})-(\d{2})(?:\b|$)/);
  if (isoMonth) return isoDateFromParts(isoMonth[1]!, isoMonth[2]!);
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return isoDateFromParts(compact[1]!, compact[2]!, compact[3]!);
  const month = trimmed.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/i,
  );
  if (month) {
    return isoDateFromParts(
      month[3]!,
      monthNumber(month[1]!),
      month[2]!.padStart(2, '0'),
    );
  }
  const year = trimmed.match(/\b(\d{4})\b/);
  if (year) return isoDateFromParts(year[1]!);
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
  const override = LOC_DATE_OVERRIDES_BY_DOCUMENT_ID[extractDocumentId(item)];
  if (override) return override;
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

/**
 * Run `worker(items[i])` in parallel with at most `concurrency` in flight at
 * once, preserving result order. Each worker is expected to return a tagged
 * outcome rather than throw — that keeps a single bad item from short-
 * circuiting the rest of the page. Internal pool, no external deps.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const pool: Promise<void>[] = [];
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  for (let lane = 0; lane < lanes; lane += 1) {
    pool.push(
      (async () => {
        while (true) {
          const idx = cursor;
          cursor += 1;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx]!, idx);
        }
      })(),
    );
  }
  await Promise.all(pool);
  return results;
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
): Promise<string> {
  const cfg = STAGE_CONFIG[stage];
  const docLabel = deps.documentId ?? 'unknown';
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    let res: Response;
    let body: string;
    try {
      res = await fetchWithTimeout(deps.fetchImpl, url, cfg);
      // Consume the body INSIDE the retry try-block. undici streams the
      // response; a mid-stream socket close (e.g. UND_ERR_SOCKET 'other side
      // closed') throws here, and that error needs to be retried just like
      // the initial fetch failing. Previously body reads happened in
      // fetchJson/fetchText after fetchWithRetry returned, so socket-close
      // failures bypassed retries entirely and surfaced as 'stage=post-fetch'
      // build failures.
      body = await res.text();
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

    if (res.ok) {
      if (body.length > MAX_BODY_BYTES) {
        throw new LocFetchError({
          stage,
          url,
          documentId: deps.documentId,
          attempts: attempt,
          errorName: 'BodyTooLargeError',
          errorMessage: `LoC body exceeded ${MAX_BODY_BYTES} bytes (received ${body.length})`,
          retryable: false,
        });
      }
      return body;
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
  const body = await fetchWithRetry(deps, url, stage);
  return JSON.parse(body) as unknown;
}

async function fetchText(deps: RetryDeps, url: string, stage: FetchStage): Promise<string> {
  return (await fetchWithRetry(deps, url, stage)).trim();
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
      "DELETE FROM ingest_progress WHERE source = 'loc'",
    ],
    'write',
  );
}

export interface IngestCursor {
  /** Next collection page to fetch; null once the collection is fully ingested. */
  nextPage: number | null;
  /** True when the source has been walked end-to-end. */
  completed: boolean;
}

export async function readIngestCursor(
  db: LibsqlClient,
  source = 'loc',
): Promise<IngestCursor | null> {
  const result = await db.execute({
    sql: 'SELECT next_page, completed FROM ingest_progress WHERE source = ? LIMIT 1',
    args: [source],
  });
  const row = result.rows[0];
  if (!row) return null;
  const nextPageRaw = row.next_page;
  const completedRaw = row.completed;
  return {
    nextPage:
      typeof nextPageRaw === 'number'
        ? nextPageRaw
        : typeof nextPageRaw === 'bigint'
          ? Number(nextPageRaw)
          : null,
    completed:
      (typeof completedRaw === 'number' && completedRaw !== 0) ||
      (typeof completedRaw === 'bigint' && completedRaw !== 0n),
  };
}

export async function writeIngestCursor(
  db: LibsqlClient,
  cursor: IngestCursor,
  source = 'loc',
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO ingest_progress (source, next_page, completed, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(source) DO UPDATE SET
            next_page = excluded.next_page,
            completed = excluded.completed,
            updated_at = excluded.updated_at`,
    args: [source, cursor.nextPage, cursor.completed ? 1 : 0, nowIso],
  });
}

export async function clearIngestCursor(
  db: LibsqlClient,
  source = 'loc',
): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM ingest_progress WHERE source = ?',
    args: [source],
  });
}

export async function ingestLocCollection(options: LocIngestOptions): Promise<LocIngestReport> {
  const dryRun = options.dryRun ?? false;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
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

  // Resolve the actual start page: explicit option wins; otherwise consult the
  // ingest_progress cursor when autoResume is set. A completed cursor short-
  // circuits the entire run so a fully-ingested collection costs ~one SELECT
  // per build.
  let startPage = options.startPage ?? 1;
  if (
    options.autoResume &&
    options.startPage == null &&
    !dryRun &&
    options.db &&
    !options.reset
  ) {
    const cursor = await readIngestCursor(options.db);
    if (cursor) {
      if (cursor.completed) {
        logger.log(
          'LoC ingest already completed (per ingest_progress); skipping. ' +
            'Use --reset or --start-page to force a re-run.',
        );
        return {
          scanned: 0,
          mapped: 0,
          written: 0,
          skipped: 0,
          withFullText: 0,
          withoutFullText: 0,
          failed: 0,
          startPage: cursor.nextPage ?? 1,
          pagesFetched: 0,
          nextPage: null,
          completed: true,
          dryRun,
          results: [],
        };
      }
      if (cursor.nextPage != null && cursor.nextPage > startPage) {
        logger.log(`Resuming LoC ingest at page ${cursor.nextPage} (from ingest_progress).`);
        startPage = cursor.nextPage;
      }
    }
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
    completed: false,
    dryRun,
    results: [],
  };

  let page = startPage;
  let remaining = options.limit ?? Number.POSITIVE_INFINITY;

  const persistCursor = async (cursor: IngestCursor): Promise<void> => {
    if (dryRun || !options.db) return;
    try {
      await writeIngestCursor(options.db, cursor, 'loc', now().toISOString());
    } catch (err) {
      const d = describeError(err);
      logger.warn(`[ingest-loc] failed to persist ingest_progress: ${d.name}: ${d.message}`);
    }
  };

  while (remaining > 0) {
    const collection = await fetchCollectionPage(makeDeps(null), page, pageSize);
    report.pagesFetched += 1;
    logger.log(`Fetched LoC page ${page} (${collection.results.length} result(s)).`);
    if (collection.results.length === 0) {
      report.nextPage = null;
      report.completed = true;
      await persistCursor({ nextPage: null, completed: true });
      break;
    }

    // Process the page's items concurrently. Each worker fetches LoC item
    // details + fulltext, maps to a Document, and (for non-skipped ok results)
    // pushes a pending-write entry. After the workers finish we flush all
    // pending writes for the page in a single Turso batch — one network
    // round-trip per page instead of one per document.
    const sliceLength = Math.min(collection.results.length, remaining);
    const itemsToProcess = collection.results.slice(0, sliceLength);
    remaining -= itemsToProcess.length;
    const processedOnPage = itemsToProcess.length;

    // Live counters for the heartbeat. Workers increment these as soon as
    // they resolve so an operator watching the Netlify log can tell whether
    // the ingest is making progress, hung on one slow item, or starting to
    // accumulate failures.
    let fetchedOnPage = 0;
    let skippedOnPage = 0;
    let failedOnPage = 0;
    const pageStart = Date.now();

    type ItemOutcome =
      | { kind: 'skipped'; result: LocIngestResult }
      | {
          kind: 'ok';
          doc: Document;
          ctx: ProvenanceContext | null;
          result: LocIngestResult;
          withFullText: boolean;
          logLine: string;
        }
      | { kind: 'error'; result: LocIngestResult; warning: string };

    const processOne = async (result: JsonObject): Promise<ItemOutcome> => {
      const predictedId = predictDocumentIdFromCollectionResult(result);
      try {
        if (!options.force && options.db) {
          if (predictedId && (await documentExists(options.db, predictedId))) {
            const skippedResult: LocIngestResult = {
              status: 'skipped',
              documentId: predictedId,
            };
            const sourceUrl = stringAt(result, 'url');
            if (sourceUrl) skippedResult.sourceUrl = sourceUrl;
            const title = stringAt(result, 'title');
            if (title) skippedResult.title = title;
            skippedOnPage += 1;
            return { kind: 'skipped', result: skippedResult };
          }
        }

        const item = await fetchItem(makeDeps(predictedId), result);
        const transcriptionUrl = extractFullTextUrl(item);
        let transcription = '';
        if (transcriptionUrl) {
          transcription = await fetchText(makeDeps(predictedId), transcriptionUrl, 'fulltext');
        }
        const document = mapLocItemToDocument(item, transcription, transcriptionUrl);

        const ctx: ProvenanceContext | null =
          !dryRun && options.db
            ? {
                sourceUrl: document.sourceUrl,
                fetchedAt: now().toISOString(),
                editor,
              }
            : null;

        const okResult: LocIngestResult = {
          status: 'ok',
          documentId: document.id,
          title: document.title,
          transcriptionLength: document.transcription.length,
        };
        if (document.sourceUrl) okResult.sourceUrl = document.sourceUrl;

        fetchedOnPage += 1;
        return {
          kind: 'ok',
          doc: document,
          ctx,
          result: okResult,
          withFullText: transcription.trim().length > 0,
          logLine: `  ${dryRun ? 'mapped' : 'fetched'} ${document.id} (${document.transcription.length} chars)`,
        };
      } catch (err) {
        failedOnPage += 1;
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
          const errResult: LocIngestResult = {
            status: 'error',
            error: summary,
            errorInfo: info,
          };
          if (info.documentId) errResult.documentId = info.documentId;
          return { kind: 'error', result: errResult, warning: summary };
        }
        const d = describeError(err);
        const summary =
          `[ingest-loc] failed LoC result stage=post-fetch ` +
          `docId=${predictedId ?? 'unknown'} error=${d.name}: ${d.message}` +
          (d.cause ? ` cause=${d.cause}` : '');
        const errResult: LocIngestResult = { status: 'error', error: summary };
        if (predictedId) errResult.documentId = predictedId;
        return { kind: 'error', result: errResult, warning: summary };
      }
    };

    // Heartbeat: emit one log line every HEARTBEAT_INTERVAL_MS so operators
    // can see the page is making progress vs. hung. unref() so the timer
    // never holds the event loop open after workers finish; clearInterval
    // in a finally keeps tests fast (sub-second pages clear before the first
    // tick fires anyway).
    const heartbeatMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    const heartbeat = setInterval(() => {
      const done = fetchedOnPage + skippedOnPage + failedOnPage;
      const elapsed = Math.round((Date.now() - pageStart) / 1000);
      logger.log(
        `  [heartbeat] page ${page}: ${done}/${itemsToProcess.length} done ` +
          `(fetched=${fetchedOnPage} skipped=${skippedOnPage} failed=${failedOnPage}), ` +
          `elapsed ${elapsed}s`,
      );
    }, heartbeatMs);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    let outcomes: ItemOutcome[];
    try {
      outcomes = await runWithConcurrency(itemsToProcess, processOne, concurrency);
    } finally {
      clearInterval(heartbeat);
    }

    // Aggregate the page's outcomes into the report. Order-preserving so the
    // results array still matches the input order, which test assertions and
    // log readers rely on. We separately count retryable failures (429/5xx/
    // network errors that exhausted retries) — those signal "LoC is currently
    // rate-limiting us", not "this item is broken", so we hold the cursor at
    // this page and let the next build retry instead of advancing past it.
    const pendingWrites: Array<{ doc: Document; ctx?: ProvenanceContext }> = [];
    let retryablePageFailures = 0;
    for (const outcome of outcomes) {
      report.scanned += 1;
      if (outcome.kind === 'skipped') {
        report.skipped += 1;
        report.results.push(outcome.result);
        logger.log(`  skipped ${outcome.result.documentId} (already in DB)`);
      } else if (outcome.kind === 'ok') {
        report.mapped += 1;
        if (outcome.withFullText) report.withFullText += 1;
        else report.withoutFullText += 1;
        report.results.push(outcome.result);
        logger.log(outcome.logLine);
        if (outcome.ctx) {
          pendingWrites.push({ doc: outcome.doc, ctx: outcome.ctx });
        }
      } else {
        report.failed += 1;
        report.results.push(outcome.result);
        logger.warn(outcome.warning);
        if (outcome.result.errorInfo?.retryable) retryablePageFailures += 1;
      }
    }

    // One Turso write per page. skip-if-exists keeps it idempotent against
    // partial prior runs; partial Turso failures roll the batch back so the
    // cursor stays at the page that failed and the next build retries it.
    if (pendingWrites.length > 0 && !dryRun && options.db) {
      const flushStart = Date.now();
      await upsertDocumentsBatch(options.db, pendingWrites, { mode: 'skip-if-exists' });
      report.written += pendingWrites.length;
      logger.log(
        `  wrote ${pendingWrites.length} document(s) to db in ${Date.now() - flushStart}ms`,
      );
    }

    // Retryable failures on this page mean LoC was likely rate-limiting us.
    // Hold the cursor here and stop the build cleanly so the next build can
    // retry the failed items. documentExists will fast-skip the ones we
    // already wrote on the next pass.
    if (retryablePageFailures > 0) {
      logger.warn(
        `[ingest-loc] holding cursor at page ${page}: ${retryablePageFailures} retryable failure(s). ` +
          `Next build will retry the failed item(s).`,
      );
      report.nextPage = page;
      report.completed = false;
      await persistCursor({ nextPage: page, completed: false });
      break;
    }

    // --limit cut us off mid-page: the next build should re-fetch THIS page
    // and rely on skip-if-exists to fast-skip the items already written.
    if (remaining <= 0 && processedOnPage < collection.results.length) {
      report.nextPage = page;
      report.completed = false;
      await persistCursor({ nextPage: page, completed: false });
      break;
    }

    // No more pages: collection is fully ingested.
    if (!collection.hasNext || collection.results.length < pageSize) {
      report.nextPage = null;
      report.completed = true;
      await persistCursor({ nextPage: null, completed: true });
      break;
    }

    page += 1;
    report.nextPage = page;
    // Per-page checkpoint: persist before we even attempt the next page so a
    // kill between pages still resumes correctly.
    await persistCursor({ nextPage: page, completed: false });
  }

  return report;
}
