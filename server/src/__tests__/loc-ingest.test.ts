import { DocumentSchema } from '@tr/shared';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';


import { createApp } from '../app.js';
import { openInMemoryDatabase, type LibsqlClient } from '../db.js';
import {
  ingestLocCollection,
  mapLocItemToDocument,
  normalizeLocDate,
  type FetchLike,
  type LocFetchErrorInfo,
} from '../sources/loc.js';

const LOC_ITEM_URL = 'https://www.loc.gov/item/mss382990022/';
const LOC_TEXT_URL =
  'https://tile.loc.gov/storage-services/service/gdc/gdccrowd/mss/mss38299/mss38299_022/mss38299-022_0001_0926.txt';

const collectionPage = {
  pagination: { next: null },
  results: [
    {
      id: 'http://www.loc.gov/item/mss382990022/',
      url: LOC_ITEM_URL,
      title:
        'Theodore Roosevelt Papers: Series 1: Letters and Related Material, 1759-1919; 1901, Nov. 12-Dec. 16',
    },
  ],
};

const locItem = {
  id: 'http://www.loc.gov/item/mss382990022/',
  url: LOC_ITEM_URL,
  title:
    'Theodore Roosevelt Papers: Series 1: Letters and Related Material, 1759-1919; 1901, Nov. 12-Dec. 16',
  date: '1901-11-12',
  contributor_names: ['Roosevelt, Theodore, 1858-1919'],
  number: ['mss382990022'],
  original_format: ['manuscript/mixed material'],
  image_url: [
    'https://tile.loc.gov/image-services/iiif/service:mss:mss38299:mss38299_022:0002/full/pct:12.5/0/default.jpg',
  ],
  subject: ['manuscripts', 'presidents'],
  shelf_id: 'mss38299, reel 22',
  rights: ['No known restrictions on use or reproduction.'],
  resources: [
    {
      files: 926,
      fulltext_file: LOC_TEXT_URL,
      url: 'https://www.loc.gov/resource/mss38299.mss38299-022_0001_0926/',
    },
  ],
  item: {
    call_number: [
      'series: Series 1: Letters and Related Material, 1759-1919',
      'mss38299, reel 22',
    ],
    contributors: ['Roosevelt, Theodore, 1858-1919'],
    source_collection: 'Theodore Roosevelt papers',
    title:
      'Theodore Roosevelt Papers: Series 1: Letters and Related Material, 1759-1919; 1901, Nov. 12-Dec. 16',
  },
};

function fakeFetch(text = 'LoC full text with unique-token-alpenglow.'): FetchLike {
  return async (url: string) => {
    if (url.includes('/collections/theodore-roosevelt-papers/')) {
      return new Response(JSON.stringify(collectionPage), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith(LOC_ITEM_URL) || url.startsWith('https://www.loc.gov/item/mss382990022/')) {
      return new Response(JSON.stringify({ item: locItem }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === LOC_TEXT_URL) {
      return new Response(text, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return new Response(`Unexpected URL: ${url}`, { status: 404 });
  };
}

const silentLogger = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const noSleep = async (): Promise<void> => undefined;

function makeRecordingLogger(): {
  log: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, statusText = ''): Response {
  return new Response(`HTTP ${status}`, {
    status,
    statusText,
    headers: { 'content-type': 'text/plain' },
  });
}

function isCollectionUrl(url: string): boolean {
  return url.includes('/collections/theodore-roosevelt-papers/');
}

function isItemUrl(url: string): boolean {
  return url.startsWith(LOC_ITEM_URL) || url.startsWith('https://www.loc.gov/item/mss382990022/');
}

describe('LoC ingestion', () => {
  let db: LibsqlClient | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('maps LoC metadata into the shared Document schema', () => {
    const doc = mapLocItemToDocument(locItem, 'transcribed text', LOC_TEXT_URL);
    expect(doc.id).toBe('loc-mss382990022');
    expect(doc.type).toBe('manuscript');
    expect(doc.date).toBe('1901-11-12');
    expect(doc.author).toBe('Theodore Roosevelt');
    expect(doc.source).toBe('Library of Congress Theodore Roosevelt Papers');
    expect(doc.sourceUrl).toBe(LOC_ITEM_URL);
    expect(doc.transcriptionUrl).toBe(LOC_TEXT_URL);
    expect(doc.tags).toContain('manuscripts');
    expect(() => DocumentSchema.parse(doc)).not.toThrow();
  });

  it('normalizes common LoC date shapes', () => {
    expect(normalizeLocDate('19011112/19011216')).toBe('1901-11-12');
    expect(normalizeLocDate('November 12, 1901 - December 16, 1901')).toBe(
      '1901-11-12',
    );
    expect(normalizeLocDate('1902')).toBe('1902-01-01');
  });

  it('does not write rows during dry run', async () => {
    db = await openInMemoryDatabase();
    const report = await ingestLocCollection({
      db,
      dryRun: true,
      limit: 1,
      fetchImpl: fakeFetch(),
      logger: silentLogger,
    });

    expect(report.scanned).toBe(1);
    expect(report.mapped).toBe(1);
    expect(report.written).toBe(0);
    const result = await db.execute('SELECT COUNT(*) AS c FROM documents');
    expect(Number(result.rows[0]?.c ?? 0)).toBe(0);
  });

  it('skips items already present without fetching item details (fast no-op)', async () => {
    db = await openInMemoryDatabase();
    // First ingest: should fetch + write the item.
    const first = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl: fakeFetch(),
      logger: silentLogger,
      now: () => new Date('2026-01-05T12:00:00.000Z'),
    });
    expect(first.written).toBe(1);
    expect(first.skipped).toBe(0);

    // Second ingest with a stub fetch that fails on item-details + full-text
    // URLs. If the ingest correctly short-circuits on documentExists, only
    // the collection page should be fetched.
    const calls: string[] = [];
    const noFetchAfterCollection: typeof fakeFetch extends () => infer F ? F : never =
      async (url: string) => {
        calls.push(url);
        if (url.includes('/collections/theodore-roosevelt-papers/')) {
          return new Response(JSON.stringify(collectionPage), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        // Anything else means we failed to short-circuit.
        throw new Error(`unexpected fetch on second ingest: ${url}`);
      };

    const second = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl: noFetchAfterCollection,
      logger: silentLogger,
    });
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.scanned).toBe(1);
    // Only the collection page should have been fetched.
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/\/collections\/theodore-roosevelt-papers\//);
  });

  it('--force re-fetches even if the row already exists', async () => {
    db = await openInMemoryDatabase();
    await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl: fakeFetch(),
      logger: silentLogger,
    });
    const forced = await ingestLocCollection({
      db,
      limit: 1,
      force: true,
      fetchImpl: fakeFetch(),
      logger: silentLogger,
    });
    expect(forced.skipped).toBe(0);
    // skip-if-exists conflict mode means the row isn't overwritten, but the
    // ingest path still ran (mapped + written counter both incremented).
    expect(forced.mapped).toBe(1);
    expect(forced.written).toBe(1);
  });

  it('ingests LoC text into the existing document and FTS search APIs', async () => {
    db = await openInMemoryDatabase();
    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl: fakeFetch(),
      logger: silentLogger,
      now: () => new Date('2026-01-05T12:00:00.000Z'),
    });
    expect(report.written).toBe(1);

    const app = createApp(db);
    const listed = await request(app).get('/api/documents?type=manuscript');
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].fieldProvenance.title.editor).toBe('loc-ingest');

    const search = await request(app).get('/api/search?q=alpenglow');
    expect(search.status).toBe(200);
    expect(search.body.total).toBe(1);
    expect(search.body.results[0].document.id).toBe('loc-mss382990022');
    expect(search.body.results[0].snippet).toContain('<mark>');
  });

  it('retries a transient 503 on the item fetch and then succeeds', async () => {
    db = await openInMemoryDatabase();
    let itemCalls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      if (isCollectionUrl(url)) return jsonResponse(collectionPage);
      if (isItemUrl(url)) {
        itemCalls += 1;
        if (itemCalls === 1) return errorResponse(503, 'Service Unavailable');
        return jsonResponse({ item: locItem });
      }
      return new Response('LoC full text with unique-token-alpenglow.', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    };
    const logger = makeRecordingLogger();

    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl,
      logger,
      sleep: noSleep,
    });

    expect(report.written).toBe(1);
    expect(report.failed).toBe(0);
    expect(itemCalls).toBe(2);
    const retryLogs = logger.log.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('retry item'));
    expect(retryLogs.length).toBe(1);
    expect(retryLogs[0]).toContain('status=503');
    expect(retryLogs[0]).toContain('docId=loc-mss382990022');
  });

  it('retries a network error then succeeds', async () => {
    db = await openInMemoryDatabase();
    let itemCalls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      if (isCollectionUrl(url)) return jsonResponse(collectionPage);
      if (isItemUrl(url)) {
        itemCalls += 1;
        if (itemCalls === 1) {
          const cause = Object.assign(new Error('terminated'), { code: 'UND_ERR_SOCKET' });
          const err = Object.assign(new TypeError('fetch failed'), { cause });
          throw err;
        }
        return jsonResponse({ item: locItem });
      }
      return new Response('LoC full text', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    };
    const logger = makeRecordingLogger();

    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl,
      logger,
      sleep: noSleep,
    });

    expect(report.failed).toBe(0);
    expect(report.written).toBe(1);
    expect(itemCalls).toBe(2);
    const retryLogs = logger.log.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('retry item'));
    expect(retryLogs[0]).toContain('error=TypeError: fetch failed');
    expect(retryLogs[0]).toContain('cause=Error: terminated');
  });

  it('retries when the response body errors mid-stream (UND_ERR_SOCKET) and then succeeds', async () => {
    db = await openInMemoryDatabase();
    let itemCalls = 0;
    // Mimics undici's "other side closed" mid-body failure: the Response is
    // returned successfully (HTTP 200), but reading its body via .text()
    // rejects with TypeError('terminated') / UND_ERR_SOCKET. Before the
    // fix, body reads happened outside fetchWithRetry and these failures
    // surfaced as 'stage=post-fetch' build breakage.
    const fetchImpl: FetchLike = async (url: string) => {
      if (isCollectionUrl(url)) return jsonResponse(collectionPage);
      if (isItemUrl(url)) {
        itemCalls += 1;
        if (itemCalls === 1) {
          const cause = Object.assign(new Error('terminated'), { code: 'UND_ERR_SOCKET' });
          const streamErr = Object.assign(new TypeError('terminated'), { cause });
          const stream = new ReadableStream({
            start(controller) {
              controller.error(streamErr);
            },
          });
          return new Response(stream, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return jsonResponse({ item: locItem });
      }
      return new Response('LoC full text', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    };
    const logger = makeRecordingLogger();

    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl,
      logger,
      sleep: noSleep,
    });

    expect(report.failed).toBe(0);
    expect(report.written).toBe(1);
    expect(itemCalls).toBe(2);
    const retryLogs = logger.log.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('retry item'));
    expect(retryLogs.length).toBeGreaterThanOrEqual(1);
    expect(retryLogs[0]).toMatch(/terminated/);
    // No post-fetch warning should fire: the body-stream failure was a
    // retried network error, not an unstructured post-fetch crash.
    const postFetchWarnings = logger.warn.mock.calls
      .map((args) => String(args[0]))
      .filter((line) => line.includes('stage=post-fetch'));
    expect(postFetchWarnings).toEqual([]);
  });

  it('exhausts retries on persistent 503 and records structured error info', async () => {
    db = await openInMemoryDatabase();
    let itemCalls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      if (isCollectionUrl(url)) return jsonResponse(collectionPage);
      if (isItemUrl(url)) {
        itemCalls += 1;
        return errorResponse(503, 'Service Unavailable');
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    const logger = makeRecordingLogger();

    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl,
      logger,
      sleep: noSleep,
    });

    expect(report.failed).toBe(1);
    expect(itemCalls).toBe(3);
    const failure = report.results[0];
    expect(failure?.status).toBe('error');
    const info = failure?.errorInfo as LocFetchErrorInfo | undefined;
    expect(info).toBeDefined();
    expect(info?.stage).toBe('item');
    expect(info?.attempts).toBe(3);
    expect(info?.httpStatus).toBe(503);
    expect(info?.documentId).toBe('loc-mss382990022');
    expect(info?.retryable).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warning = String(logger.warn.mock.calls[0]?.[0] ?? '');
    expect(warning).toContain('stage=item');
    expect(warning).toContain('attempts=3');
    expect(warning).toContain('http=503');
    expect(warning).toContain('docId=loc-mss382990022');
  });

  it('does not retry on 404', async () => {
    db = await openInMemoryDatabase();
    let itemCalls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      if (isCollectionUrl(url)) return jsonResponse(collectionPage);
      if (isItemUrl(url)) {
        itemCalls += 1;
        return errorResponse(404, 'Not Found');
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    const logger = makeRecordingLogger();

    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl,
      logger,
      sleep: noSleep,
    });

    expect(itemCalls).toBe(1);
    expect(report.failed).toBe(1);
    const info = report.results[0]?.errorInfo;
    expect(info?.attempts).toBe(1);
    expect(info?.retryable).toBe(false);
    expect(info?.httpStatus).toBe(404);
  });

  it('honors Retry-After on 429', async () => {
    db = await openInMemoryDatabase();
    let itemCalls = 0;
    const sleepWaits: number[] = [];
    const fetchImpl: FetchLike = async (url: string) => {
      if (isCollectionUrl(url)) return jsonResponse(collectionPage);
      if (isItemUrl(url)) {
        itemCalls += 1;
        if (itemCalls === 1) {
          return new Response('rate-limited', {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'content-type': 'text/plain', 'retry-after': '2' },
          });
        }
        return jsonResponse({ item: locItem });
      }
      return new Response('LoC full text', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    };
    const logger = makeRecordingLogger();

    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl,
      logger,
      sleep: async (ms) => {
        sleepWaits.push(ms);
      },
    });

    expect(report.failed).toBe(0);
    expect(sleepWaits).toContain(2000);
    const retryLog = logger.log.mock.calls
      .map((args) => String(args[0]))
      .find((line) => line.includes('retry item') && line.includes('status=429'));
    expect(retryLog).toBeDefined();
    expect(retryLog).toContain('after 2000ms');
  });

  it('labels fulltext stage when the fulltext fetch fails', async () => {
    db = await openInMemoryDatabase();
    const fetchImpl: FetchLike = async (url: string) => {
      if (isCollectionUrl(url)) return jsonResponse(collectionPage);
      if (isItemUrl(url)) return jsonResponse({ item: locItem });
      return errorResponse(503, 'Service Unavailable');
    };
    const logger = makeRecordingLogger();

    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl,
      logger,
      sleep: noSleep,
    });

    expect(report.failed).toBe(1);
    const info = report.results[0]?.errorInfo;
    expect(info?.stage).toBe('fulltext');
    expect(info?.documentId).toBe('loc-mss382990022');
    expect(info?.attempts).toBe(3);
  });

  it('JSON parse errors on a 200 fail fast without retry', async () => {
    db = await openInMemoryDatabase();
    let itemCalls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      if (isCollectionUrl(url)) return jsonResponse(collectionPage);
      if (isItemUrl(url)) {
        itemCalls += 1;
        return new Response('not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    const logger = makeRecordingLogger();

    const report = await ingestLocCollection({
      db,
      limit: 1,
      fetchImpl,
      logger,
      sleep: noSleep,
    });

    expect(itemCalls).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.results[0]?.status).toBe('error');
    // Post-fetch (JSON parse) errors take the non-LocFetchError branch and
    // therefore don't carry structured errorInfo.
    expect(report.results[0]?.errorInfo).toBeUndefined();
    const warning = String(logger.warn.mock.calls[0]?.[0] ?? '');
    expect(warning).toContain('stage=post-fetch');
    expect(warning).toContain('docId=loc-mss382990022');
  });
});
