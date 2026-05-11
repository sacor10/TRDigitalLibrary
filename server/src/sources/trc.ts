import type { InStatement, InValue } from '@libsql/client';
import { load, type CheerioAPI } from 'cheerio';

import type { LibsqlClient } from '../db.js';

import { readIngestCursor, writeIngestCursor } from './loc.js';

export const TRC_SOURCE = 'Theodore Roosevelt Center Digital Library';
export const TRC_BASE_URL = 'https://www.theodorerooseveltcenter.org';
export const TRC_DIGITAL_LIBRARY_URL = `${TRC_BASE_URL}/digital-library/`;
export const TR_CORRESPONDENT_ID = 'theodore-roosevelt';
export const TR_CORRESPONDENT_LABEL = 'Theodore Roosevelt';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 50;
const DEFAULT_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_FETCH_ATTEMPTS = 3;

const TR_AUTHORITY_SLUGS = new Set([
  'roosevelt-theodore-1858-1919',
  'secretary-of-theodore-roosevelt',
]);

const TR_NAME_PATTERNS = [
  /^roosevelt,\s*theodore\b/i,
  /^theodore\s+roosevelt\b/i,
  /^secretary\s+of\s+theodore\s+roosevelt$/i,
  /^theodore\s+roosevelt'?s\s+secretary$/i,
];

export type TrcResourceType = 'letter' | 'telegram';
export type TrcParticipantRole = 'creator' | 'recipient';

export interface TrcSearchEndpoint {
  role: TrcParticipantRole;
  slug: string;
}

export const DEFAULT_TRC_SEARCH_ENDPOINTS: TrcSearchEndpoint[] = [
  { role: 'creator', slug: 'roosevelt-theodore-1858-1919' },
  { role: 'recipient', slug: 'roosevelt-theodore-1858-1919' },
  { role: 'creator', slug: 'secretary-of-theodore-roosevelt' },
];

export interface TrcPersonRef {
  label: string;
  authoritySlug: string | null;
  authorityUrl: string | null;
}

export interface TrcCorrespondenceItem {
  id: string;
  title: string;
  sourceUrl: string;
  date: string | null;
  dateDisplay: string | null;
  resourceType: TrcResourceType;
  collection: string | null;
  repository: string | null;
  language: string | null;
  period: string | null;
  pageCount: string | null;
  productionMethod: string | null;
  recordType: string | null;
  rights: string | null;
  creators: TrcPersonRef[];
  recipients: TrcPersonRef[];
}

export interface TrcSearchPage {
  total: number | null;
  hasNext: boolean;
  items: TrcCorrespondenceItem[];
}

export interface TrcIngestJobReport {
  source: string;
  scanned: number;
  mapped: number;
  written: number;
  skipped: number;
  failed: number;
  pagesFetched: number;
  completed: boolean;
  nextPage: number | null;
}

export interface TrcIngestReport {
  scanned: number;
  mapped: number;
  written: number;
  skipped: number;
  failed: number;
  pagesFetched: number;
  completed: boolean;
  dryRun: boolean;
  jobs: TrcIngestJobReport[];
}

export interface TrcIngestOptions {
  db: LibsqlClient | null;
  dryRun?: boolean;
  reset?: boolean;
  limit?: number;
  startPage?: number;
  autoResume?: boolean;
  pageSize?: number;
  delayMs?: number;
  resourceTypes?: TrcResourceType[];
  endpoints?: TrcSearchEndpoint[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  sleep?: (ms: number) => Promise<void>;
}

interface CanonicalCorrespondent {
  id: string;
  label: string;
  sortLabel: string;
  trcSlug: string | null;
  trcUrl: string | null;
  isTR: boolean;
}

function asFinitePositiveInt(raw: number | undefined, fallback: number): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function slugifyCorrespondent(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function absoluteUrl(raw: string): string {
  return new URL(raw, TRC_BASE_URL).toString();
}

function authoritySlugFromUrl(rawUrl: string, role: TrcParticipantRole): string | null {
  try {
    const url = new URL(rawUrl, TRC_BASE_URL);
    const marker = `/${role}/`;
    const idx = url.pathname.indexOf(marker);
    if (idx < 0) return null;
    const rest = url.pathname.slice(idx + marker.length);
    return rest.split('/').find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function recordIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, TRC_BASE_URL);
    const match = url.pathname.match(/\/digital-library\/(o\d+)\/?/i);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}$/.test(value)) return `${value}-01-01`;
  const month = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b/i,
  );
  if (month) {
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
    const mm = String(months.indexOf(month[1]!.toLowerCase()) + 1).padStart(2, '0');
    const dd = month[2]!.padStart(2, '0');
    return `${month[3]}-${mm}-${dd}`;
  }
  return null;
}

function fieldValue($: CheerioAPI, fields: Map<string, ReturnType<CheerioAPI>>, label: string) {
  const node = fields.get(label);
  return node ? normalizeWhitespace($(node).text()) || null : null;
}

function parsePersonRefs(
  $: CheerioAPI,
  fields: Map<string, ReturnType<CheerioAPI>>,
  label: string,
  role: TrcParticipantRole,
): TrcPersonRef[] {
  const node = fields.get(label);
  if (!node) return [];
  const links = $(node)
    .find(`a[href*="/${role}/"]`)
    .toArray()
    .map((a) => {
      const link = $(a);
      const name = normalizeWhitespace(link.text());
      const href = link.attr('href');
      if (!name) return null;
      const authorityUrl = href ? absoluteUrl(href) : null;
      return {
        label: name,
        authoritySlug: href ? authoritySlugFromUrl(href, role) : null,
        authorityUrl,
      } satisfies TrcPersonRef;
    })
    .filter((p): p is TrcPersonRef => p !== null);

  if (links.length > 0) return links;

  const text = normalizeWhitespace($(node).text());
  if (!text) return [];
  return splitPersonText(text, false);
}

function splitPersonText(raw: string, allowCommaSplit: boolean): TrcPersonRef[] {
  const text = normalizeWhitespace(raw);
  if (!text) return [];
  const parts = text.split(/\s*;\s*/).flatMap((part) => {
    const looksLikeNaturalList = /\s+and\s+|,\s*and\s+/i.test(part);
    if (allowCommaSplit || looksLikeNaturalList) {
      return part.split(/\s*,\s*|\s+and\s+/);
    }
    return [part];
  });
  return parts
    .map((part) => normalizeWhitespace(part).replace(/^and\s+/i, ''))
    .filter(Boolean)
    .map((label) => ({ label, authoritySlug: null, authorityUrl: null }));
}

function titlePersonRefs(raw: string): TrcPersonRef[] {
  return splitPersonText(raw, true);
}

function participantFallbackFromTitle(title: string): {
  creators: TrcPersonRef[];
  recipients: TrcPersonRef[];
} {
  const match = title.match(/^(?:Letter|Telegram)\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (!match) return { creators: [], recipients: [] };
  return {
    creators: titlePersonRefs(match[1]!),
    recipients: titlePersonRefs(match[2]!),
  };
}

function normalizeResourceType(raw: string | null): TrcResourceType | null {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'letter' || normalized === 'telegram') return normalized;
  return null;
}

function isTrPerson(ref: TrcPersonRef): boolean {
  if (ref.authoritySlug && TR_AUTHORITY_SLUGS.has(ref.authoritySlug)) return true;
  const label = normalizeWhitespace(ref.label);
  return TR_NAME_PATTERNS.some((pattern) => pattern.test(label));
}

function canonicalizePerson(ref: TrcPersonRef): CanonicalCorrespondent | null {
  if (isTrPerson(ref)) {
    return {
      id: TR_CORRESPONDENT_ID,
      label: TR_CORRESPONDENT_LABEL,
      sortLabel: 'roosevelt, theodore',
      trcSlug: ref.authoritySlug ?? 'roosevelt-theodore-1858-1919',
      trcUrl:
        ref.authorityUrl ??
        `${TRC_BASE_URL}/creator/roosevelt-theodore-1858-1919/`,
      isTR: true,
    };
  }

  const label = normalizeWhitespace(ref.label);
  if (!label) return null;
  const id = ref.authoritySlug ?? slugifyCorrespondent(label);
  if (!id) return null;
  return {
    id,
    label,
    sortLabel: label.toLowerCase(),
    trcSlug: ref.authoritySlug,
    trcUrl: ref.authorityUrl,
    isTR: false,
  };
}

function isEgoItem(item: TrcCorrespondenceItem): boolean {
  return [...item.creators, ...item.recipients].some(isTrPerson);
}

function parseFields($: CheerioAPI, article: ReturnType<CheerioAPI>) {
  const out = new Map<string, ReturnType<CheerioAPI>>();
  const text = article.find('> .tease-text').first();
  text.children('h3.wp-block-heading').each((_, heading) => {
    const key = normalizeWhitespace($(heading).text());
    const value = $(heading).next('p');
    if (key && value.length > 0) out.set(key, value);
  });
  return out;
}

export function parseTrcSearchPage(
  html: string,
  fallbackResourceType: TrcResourceType,
): TrcSearchPage {
  const $ = load(html);
  const totalText = normalizeWhitespace($('.digital-library-options .h3').first().text());
  const totalMatch = totalText.match(/([\d,]+)\s+Results/i);
  const total = totalMatch ? Number(totalMatch[1]!.replace(/,/g, '')) : null;
  const hasNext =
    $('link[rel="next"]').length > 0 ||
    $('.pagination-block a.button--next, .pagination-block a[rel="next"]').length > 0;

  const items: TrcCorrespondenceItem[] = [];
  $('article.tease-digital-library').each((_, el) => {
    const article = $(el);
    const titleLink = article.find('h2.tease-title a').first();
    const href = titleLink.attr('href');
    const title = normalizeWhitespace(titleLink.text());
    if (!href || !title) return;

    const sourceUrl = absoluteUrl(href);
    const recordId = recordIdFromUrl(sourceUrl);
    if (!recordId) return;

    const fields = parseFields($, article);
    const dateDisplay = fieldValue($, fields, 'Creation Date');
    const resourceType =
      normalizeResourceType(fieldValue($, fields, 'Resource Type')) ?? fallbackResourceType;
    const titleParticipants = participantFallbackFromTitle(title);
    const creators = parsePersonRefs($, fields, 'Creator(s)', 'creator');
    const recipients = parsePersonRefs($, fields, 'Recipient', 'recipient');

    items.push({
      id: `trc-${recordId}`,
      title,
      sourceUrl,
      date: normalizeDate(dateDisplay),
      dateDisplay,
      resourceType,
      collection: fieldValue($, fields, 'Collection'),
      repository: fieldValue($, fields, 'Repository'),
      language: fieldValue($, fields, 'Language'),
      period: fieldValue($, fields, 'Period'),
      pageCount: fieldValue($, fields, 'Page Count'),
      productionMethod: fieldValue($, fields, 'Production Method'),
      recordType: fieldValue($, fields, 'Record Type'),
      rights: fieldValue($, fields, 'Rights'),
      creators: creators.length > 0 ? creators : titleParticipants.creators,
      recipients: recipients.length > 0 ? recipients : titleParticipants.recipients,
    });
  });

  return { total, hasNext, items };
}

export function trcSearchUrl(
  page: number,
  pageSize: number,
  resourceType: TrcResourceType,
  endpoint: TrcSearchEndpoint,
): string {
  const path = page <= 1 ? '/digital-library/' : `/digital-library/page/${page}/`;
  const url = new URL(path, TRC_BASE_URL);
  url.searchParams.set('resource_type', resourceType);
  url.searchParams.set('per_page', String(pageSize));
  url.searchParams.set('sort', 'date');
  url.searchParams.set('view', 'expanded');
  url.searchParams.append(`${endpoint.role}[]`, endpoint.slug);
  return url.toString();
}

function trcProgressSource(
  resourceType: TrcResourceType,
  endpoint: TrcSearchEndpoint,
  pageSize: number,
): string {
  return `trc:${resourceType}:${endpoint.role}:${endpoint.slug}:per-page-${pageSize}`;
}

async function fetchTextWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  logger: Pick<Console, 'log' | 'warn' | 'error'>,
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        headers: {
          Accept: 'text/html',
          'User-Agent':
            'TRDigitalLibrary/0.1 (TRC metadata ingest; contact via https://github.com/sacor10/trdigitallibrary)',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_FETCH_ATTEMPTS) {
        logger.warn(`[ingest-trc] retrying ${url} after ${String(err)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function resetTrcNetwork(db: LibsqlClient): Promise<void> {
  await db.batch(
    [
      'DELETE FROM correspondence_participants',
      'DELETE FROM correspondence_items',
      'DELETE FROM correspondents',
      "DELETE FROM ingest_progress WHERE source LIKE 'trc:%'",
    ],
    'write',
  );
}

export async function upsertTrcCorrespondenceItems(
  db: LibsqlClient,
  items: TrcCorrespondenceItem[],
  fetchedAt: string,
): Promise<void> {
  if (items.length === 0) return;
  const stmts: InStatement[] = [];

  for (const item of items) {
    const participantRows: Array<{
      role: TrcParticipantRole;
      ordinal: number;
      raw: TrcPersonRef;
      canonical: CanonicalCorrespondent;
    }> = [];
    for (const [role, refs] of [
      ['creator', item.creators],
      ['recipient', item.recipients],
    ] as const) {
      refs.forEach((ref, ordinal) => {
        const canonical = canonicalizePerson(ref);
        if (!canonical) return;
        participantRows.push({ role, ordinal, raw: ref, canonical });
      });
    }

    if (
      !participantRows.some((p) => p.role === 'creator') ||
      !participantRows.some((p) => p.role === 'recipient')
    ) {
      continue;
    }

    const correspondents = new Map<string, CanonicalCorrespondent>();
    participantRows.forEach((p) => correspondents.set(p.canonical.id, p.canonical));
    for (const correspondent of correspondents.values()) {
      stmts.push({
        sql: `INSERT INTO correspondents
                (id, label, sort_label, trc_slug, trc_url, is_tr, updated_at)
              VALUES
                (@id, @label, @sort_label, @trc_slug, @trc_url, @is_tr, @updated_at)
              ON CONFLICT(id) DO UPDATE SET
                label = CASE WHEN correspondents.is_tr = 1 THEN correspondents.label ELSE excluded.label END,
                sort_label = excluded.sort_label,
                trc_slug = COALESCE(correspondents.trc_slug, excluded.trc_slug),
                trc_url = COALESCE(correspondents.trc_url, excluded.trc_url),
                is_tr = CASE WHEN correspondents.is_tr = 1 OR excluded.is_tr = 1 THEN 1 ELSE 0 END,
                updated_at = excluded.updated_at`,
        args: {
          id: correspondent.id,
          label: correspondent.label,
          sort_label: correspondent.sortLabel,
          trc_slug: correspondent.trcSlug,
          trc_url: correspondent.trcUrl,
          is_tr: correspondent.isTR ? 1 : 0,
          updated_at: fetchedAt,
        } satisfies Record<string, InValue>,
      });
    }

    stmts.push({
      sql: `INSERT INTO correspondence_items
              (id, title, source_url, date, date_display, resource_type, collection, repository,
               language, period, page_count, production_method, record_type, rights, fetched_at, updated_at)
            VALUES
              (@id, @title, @source_url, @date, @date_display, @resource_type, @collection, @repository,
               @language, @period, @page_count, @production_method, @record_type, @rights, @fetched_at, @updated_at)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              source_url = excluded.source_url,
              date = excluded.date,
              date_display = excluded.date_display,
              resource_type = excluded.resource_type,
              collection = excluded.collection,
              repository = excluded.repository,
              language = excluded.language,
              period = excluded.period,
              page_count = excluded.page_count,
              production_method = excluded.production_method,
              record_type = excluded.record_type,
              rights = excluded.rights,
              fetched_at = excluded.fetched_at,
              updated_at = excluded.updated_at`,
      args: {
        id: item.id,
        title: item.title,
        source_url: item.sourceUrl,
        date: item.date,
        date_display: item.dateDisplay,
        resource_type: item.resourceType,
        collection: item.collection,
        repository: item.repository,
        language: item.language,
        period: item.period,
        page_count: item.pageCount,
        production_method: item.productionMethod,
        record_type: item.recordType,
        rights: item.rights,
        fetched_at: fetchedAt,
        updated_at: fetchedAt,
      } satisfies Record<string, InValue>,
    });

    stmts.push({
      sql: 'DELETE FROM correspondence_participants WHERE item_id = ?',
      args: [item.id],
    });
    for (const p of participantRows) {
      stmts.push({
        sql: `INSERT INTO correspondence_participants
                (item_id, correspondent_id, role, raw_name, authority_slug, authority_url, ordinal)
              VALUES
                (@item_id, @correspondent_id, @role, @raw_name, @authority_slug, @authority_url, @ordinal)`,
        args: {
          item_id: item.id,
          correspondent_id: p.canonical.id,
          role: p.role,
          raw_name: p.raw.label,
          authority_slug: p.raw.authoritySlug,
          authority_url: p.raw.authorityUrl,
          ordinal: p.ordinal,
        } satisfies Record<string, InValue>,
      });
    }
  }

  if (stmts.length > 0) await db.batch(stmts, 'write');
}

function emptyJobReport(source: string): TrcIngestJobReport {
  return {
    source,
    scanned: 0,
    mapped: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    pagesFetched: 0,
    completed: false,
    nextPage: null,
  };
}

function addJobTotals(report: TrcIngestReport, job: TrcIngestJobReport): void {
  report.scanned += job.scanned;
  report.mapped += job.mapped;
  report.written += job.written;
  report.skipped += job.skipped;
  report.failed += job.failed;
  report.pagesFetched += job.pagesFetched;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ingestTrcCorrespondence(options: TrcIngestOptions): Promise<TrcIngestReport> {
  const dryRun = options.dryRun ?? false;
  if (!dryRun && !options.db) throw new Error('A database is required unless --dry-run is set');

  const db = options.db;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_DELAY_MS);
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    asFinitePositiveInt(options.pageSize, Math.min(DEFAULT_PAGE_SIZE, limit)),
  );
  const resourceTypes = options.resourceTypes ?? ['letter', 'telegram'];
  const endpoints = options.endpoints ?? DEFAULT_TRC_SEARCH_ENDPOINTS;
  const autoResume = options.autoResume ?? true;

  if (!dryRun && options.reset && db) {
    await resetTrcNetwork(db);
    logger.log('[ingest-trc] reset existing TRC correspondence network rows.');
  }

  const report: TrcIngestReport = {
    scanned: 0,
    mapped: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    pagesFetched: 0,
    completed: true,
    dryRun,
    jobs: [],
  };

  let remaining = limit;
  for (const resourceType of resourceTypes) {
    for (const endpoint of endpoints) {
      if (remaining <= 0) break;
      const source = trcProgressSource(resourceType, endpoint, pageSize);
      const job = emptyJobReport(source);
      report.jobs.push(job);

      let page = options.startPage ?? 1;
      if (autoResume && options.startPage == null && db && !dryRun && !options.reset) {
        const cursor = await readIngestCursor(db, source);
        if (cursor?.completed) {
          job.completed = true;
          job.nextPage = null;
          continue;
        }
        if (cursor?.nextPage && cursor.nextPage > page) page = cursor.nextPage;
      }

      while (remaining > 0) {
        const url = trcSearchUrl(page, pageSize, resourceType, endpoint);
        logger.log(`[ingest-trc] fetching ${url}`);
        try {
          const html = await fetchTextWithRetry(fetchImpl, url, logger);
          job.pagesFetched += 1;
          const parsed = parseTrcSearchPage(html, resourceType);
          job.scanned += parsed.items.length;
          const egoItems = parsed.items.filter(isEgoItem);
          const writable = egoItems.slice(0, remaining);
          job.mapped += writable.length;
          job.skipped += parsed.items.length - writable.length;
          remaining -= writable.length;

          if (writable.length > 0 && db && !dryRun) {
            await upsertTrcCorrespondenceItems(db, writable, now().toISOString());
            job.written += writable.length;
          }

          const completed = !parsed.hasNext || parsed.items.length === 0;
          job.completed = completed;
          job.nextPage = completed ? null : page + 1;
          if (db && !dryRun) {
            await writeIngestCursor(db, { nextPage: job.nextPage, completed }, source);
          }
          if (completed || remaining <= 0) break;
          page += 1;
          if (delayMs > 0) await sleep(delayMs);
        } catch (err) {
          job.failed += 1;
          job.completed = false;
          job.nextPage = page;
          if (db && !dryRun) {
            await writeIngestCursor(db, { nextPage: page, completed: false }, source);
          }
          logger.warn(`[ingest-trc] failed page ${page} (${source}): ${String(err)}`);
          break;
        }
      }
      addJobTotals(report, job);
    }
  }

  report.completed = report.jobs.every((job) => job.completed);
  return report;
}
