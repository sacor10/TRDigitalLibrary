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

const locFirstSeriesRangeItem = {
  id: 'http://www.loc.gov/item/mss382990001/',
  url: 'https://www.loc.gov/item/mss382990001/',
  title:
    'Theodore Roosevelt Papers: Series 1: Letters and Related Material, 1759-1919; 1759, Aug.-1898, May',
  date: '1759-08',
  contributor_names: ['Roosevelt, Theodore, 1858-1919'],
  number: ['mss382990001'],
  original_format: ['manuscript/mixed material'],
  item: {
    call_number: [
      'mss38299, reel 1',
      'series: Series 1: Letters and Related Material, 1759-1919',
    ],
    contributors: ['Roosevelt, Theodore, 1858-1919'],
    source_collection: 'Theodore Roosevelt papers',
    title:
      'Theodore Roosevelt Papers: Series 1: Letters and Related Material, 1759-1919; 1759, Aug.-1898, May',
    date: '17590800/18980500',
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
    expect(normalizeLocDate('17590800/18980500')).toBe('1759-08-01');
    expect(normalizeLocDate('November 12, 1901 - December 16, 1901')).toBe(
      '1901-11-12',
    );
    expect(normalizeLocDate('1759-08')).toBe('1759-08-01');
    expect(normalizeLocDate('1902')).toBe('1902-01-01');
  });

  it('dates the first Series 1 range item to the earliest TR-authored work', () => {
    const doc = mapLocItemToDocument(locFirstSeriesRangeItem);

    expect(doc.id).toBe('loc-mss382990001');
    expect(doc.date).toBe('1877-01-01');
    expect(() => DocumentSchema.parse(doc)).not.toThrow();
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
    expect(itemCalls).toBe(5);
    const failure = report.results[0];
    expect(failure?.status).toBe('error');
    const info = failure?.errorInfo as LocFetchErrorInfo | undefined;
    expect(info).toBeDefined();
    expect(info?.stage).toBe('item');
    expect(info?.attempts).toBe(5);
    expect(info?.httpStatus).toBe(503);
    expect(info?.documentId).toBe('loc-mss382990022');
    expect(info?.retryable).toBe(true);
    const warnings = logger.warn.mock.calls.map((args) => String(args[0]));
    const itemWarning = warnings.find((w) => w.includes('stage=item')) ?? '';
    expect(itemWarning).toContain('attempts=5');
    expect(itemWarning).toContain('http=503');
    expect(itemWarning).toContain('docId=loc-mss382990022');
    // Cursor-hold warning fires too because the failure was retryable.
    expect(warnings.some((w) => w.includes('holding cursor'))).toBe(true);
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
    expect(info?.attempts).toBe(5);
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

  describe('chunked ingest with ingest_progress cursor', () => {
    // A two-page collection: page 1 has the existing locItem; page 2 has a
    // second item with a different id. The pagination.next field on page 1
    // signals there's more to fetch; page 2's null next signals end.
    const locItem2Url = 'https://www.loc.gov/item/mss382990099/';
    const collectionPage1 = {
      pagination: { next: 'https://www.loc.gov/collections/theodore-roosevelt-papers/?sp=2' },
      results: [
        {
          id: 'http://www.loc.gov/item/mss382990022/',
          url: LOC_ITEM_URL,
          title: 'page 1 item',
        },
      ],
    };
    const collectionPage2 = {
      pagination: { next: null },
      results: [
        {
          id: 'http://www.loc.gov/item/mss382990099/',
          url: locItem2Url,
          title: 'page 2 item',
        },
      ],
    };
    const locItem2 = {
      ...locItem,
      id: 'http://www.loc.gov/item/mss382990099/',
      url: locItem2Url,
      number: ['mss382990099'],
      resources: [
        {
          files: 1,
          fulltext_file:
            'https://tile.loc.gov/storage-services/service/gdc/gdccrowd/mss/page2-fulltext.txt',
          url: 'https://www.loc.gov/resource/mss38299.page2/',
        },
      ],
    };

    function multiPageFetch(): FetchLike {
      return async (url: string) => {
        if (url.includes('sp=2') && isCollectionUrl(url)) return jsonResponse(collectionPage2);
        if (isCollectionUrl(url)) return jsonResponse(collectionPage1);
        if (url.startsWith(LOC_ITEM_URL)) return jsonResponse({ item: locItem });
        if (url.startsWith(locItem2Url)) return jsonResponse({ item: locItem2 });
        return new Response('LoC full text with unique-token-alpenglow.', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      };
    }

    it('writes the cursor with next_page=2 after page 1 completes (limit=1)', async () => {
      db = await openInMemoryDatabase();
      const report = await ingestLocCollection({
        db,
        limit: 1,
        pageSize: 1,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      expect(report.written).toBe(1);
      expect(report.completed).toBe(false);
      expect(report.nextPage).toBe(2);
      const row = await db.execute(
        "SELECT next_page, completed FROM ingest_progress WHERE source = 'loc'",
      );
      expect(Number(row.rows[0]?.next_page)).toBe(2);
      expect(Number(row.rows[0]?.completed)).toBe(0);
    });

    it('marks the cursor completed when the collection is fully ingested', async () => {
      db = await openInMemoryDatabase();
      const report = await ingestLocCollection({
        db,
        pageSize: 1,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      expect(report.written).toBe(2);
      expect(report.completed).toBe(true);
      expect(report.nextPage).toBeNull();
      const row = await db.execute(
        "SELECT next_page, completed FROM ingest_progress WHERE source = 'loc'",
      );
      expect(row.rows[0]?.next_page).toBeNull();
      expect(Number(row.rows[0]?.completed)).toBe(1);
    });

    it('auto-resumes from the cursor when startPage is not explicitly set', async () => {
      db = await openInMemoryDatabase();
      // First chunk: ingest page 1 only.
      await ingestLocCollection({
        db,
        limit: 1,
        pageSize: 1,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      // Second chunk: autoResume should pick up at page 2 and write the
      // second document.
      const second = await ingestLocCollection({
        db,
        pageSize: 1,
        autoResume: true,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      expect(second.startPage).toBe(2);
      expect(second.written).toBe(1);
      expect(second.completed).toBe(true);
      const rows = await db.execute('SELECT COUNT(*) AS c FROM documents');
      expect(Number(rows.rows[0]?.c)).toBe(2);
    });

    it('early-exits when the cursor is already marked completed', async () => {
      db = await openInMemoryDatabase();
      // Fully ingest first.
      await ingestLocCollection({
        db,
        pageSize: 1,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      // Subsequent autoResume run must not call fetch at all.
      const noFetch: FetchLike = async (url) => {
        throw new Error(`unexpected fetch on completed cursor: ${url}`);
      };
      const report = await ingestLocCollection({
        db,
        autoResume: true,
        fetchImpl: noFetch,
        logger: silentLogger,
      });
      expect(report.scanned).toBe(0);
      expect(report.completed).toBe(true);
      expect(report.pagesFetched).toBe(0);
    });

    it('explicit startPage overrides the cursor (autoResume disabled)', async () => {
      db = await openInMemoryDatabase();
      // Seed a cursor that says "resume at page 2".
      await ingestLocCollection({
        db,
        limit: 1,
        pageSize: 1,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      // Caller passes startPage=1 explicitly — should NOT auto-resume.
      const report = await ingestLocCollection({
        db,
        limit: 1,
        pageSize: 1,
        startPage: 1,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      expect(report.startPage).toBe(1);
      // The page 1 item is already in the DB, so this re-fetch should skip.
      expect(report.skipped).toBe(1);
    });

    it('emits a heartbeat line while a page is in flight', async () => {
      db = await openInMemoryDatabase();
      // Stall every item fetch long enough that at least one heartbeat tick
      // (interval=20ms) fires before the page completes.
      const slowFetch: FetchLike = async (url: string) => {
        if (isCollectionUrl(url)) return jsonResponse(collectionPage);
        await new Promise((r) => setTimeout(r, 80));
        if (url.startsWith(LOC_ITEM_URL)) return jsonResponse({ item: locItem });
        return new Response('LoC full text', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      };
      const logger = makeRecordingLogger();
      await ingestLocCollection({
        db,
        limit: 1,
        fetchImpl: slowFetch,
        logger,
        heartbeatIntervalMs: 20,
      });
      const lines = logger.log.mock.calls.map((args) => String(args[0]));
      const heartbeats = lines.filter((l) => l.includes('[heartbeat]'));
      expect(heartbeats.length).toBeGreaterThan(0);
      expect(heartbeats[0]).toMatch(/page \d+: \d+\/\d+ done/);
      expect(heartbeats[0]).toContain('fetched=');
      expect(heartbeats[0]).toContain('failed=');
    });

    it('holds the cursor at the current page when retryable failures occur', async () => {
      db = await openInMemoryDatabase();
      // Two items on one page; the second one always returns 429.
      const item2Id = 'mss382990777';
      const item2Url = `https://www.loc.gov/item/${item2Id}/`;
      const twoItemPage = {
        pagination: { next: null },
        results: [
          {
            id: 'http://www.loc.gov/item/mss382990022/',
            url: LOC_ITEM_URL,
            title: 'good item',
          },
          {
            id: `http://www.loc.gov/item/${item2Id}/`,
            url: item2Url,
            title: 'rate-limited item',
          },
        ],
      };
      const fetchImpl: FetchLike = async (url: string) => {
        if (isCollectionUrl(url)) return jsonResponse(twoItemPage);
        if (url.startsWith(item2Url)) return errorResponse(429, 'Too Many Requests');
        if (url.startsWith(LOC_ITEM_URL)) return jsonResponse({ item: locItem });
        return new Response('LoC full text', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      };

      const report = await ingestLocCollection({
        db,
        fetchImpl,
        logger: silentLogger,
        sleep: noSleep,
        concurrency: 1,
      });

      // Good item was written; bad item failed retryably.
      expect(report.written).toBe(1);
      expect(report.failed).toBe(1);
      // Cursor must NOT advance past the failing page.
      expect(report.nextPage).toBe(1);
      expect(report.completed).toBe(false);
      const cursor = await db.execute(
        "SELECT next_page, completed FROM ingest_progress WHERE source = 'loc'",
      );
      expect(Number(cursor.rows[0]?.next_page)).toBe(1);
      expect(Number(cursor.rows[0]?.completed)).toBe(0);
    });

    it('fetches items concurrently and flushes the page as a single batched write', async () => {
      db = await openInMemoryDatabase();

      // Build a 5-item collection page with distinct ids so we can observe
      // multiple concurrent item fetches in flight at once.
      const items = Array.from({ length: 5 }, (_, i) => {
        const num = `mss5500${i.toString().padStart(2, '0')}`;
        return {
          collection: {
            id: `http://www.loc.gov/item/${num}/`,
            url: `https://www.loc.gov/item/${num}/`,
            title: `concurrent item ${i}`,
          },
          item: {
            ...locItem,
            id: `http://www.loc.gov/item/${num}/`,
            url: `https://www.loc.gov/item/${num}/`,
            number: [num],
          },
          docId: `loc-${num}`,
        };
      });
      const concurrentPage = {
        pagination: { next: null },
        results: items.map((x) => x.collection),
      };

      let itemInFlight = 0;
      let itemPeakInFlight = 0;
      const fetchImpl: FetchLike = async (url: string) => {
        if (isCollectionUrl(url)) return jsonResponse(concurrentPage);
        for (const x of items) {
          if (url.startsWith(x.collection.url)) {
            itemInFlight += 1;
            itemPeakInFlight = Math.max(itemPeakInFlight, itemInFlight);
            // Yield to the event loop so the pool actually overlaps requests.
            await new Promise((r) => setTimeout(r, 5));
            itemInFlight -= 1;
            return jsonResponse({ item: x.item });
          }
        }
        return new Response('LoC full text with unique-token-alpenglow.', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      };

      const report = await ingestLocCollection({
        db,
        fetchImpl,
        logger: silentLogger,
        concurrency: 4,
      });

      expect(report.written).toBe(5);
      expect(report.failed).toBe(0);
      expect(itemPeakInFlight).toBeGreaterThan(1); // proves overlap occurred
      const count = await db.execute('SELECT COUNT(*) AS c FROM documents');
      expect(Number(count.rows[0]?.c)).toBe(5);
    });

    it('--reset clears the cursor so the next run starts at page 1', async () => {
      db = await openInMemoryDatabase();
      await ingestLocCollection({
        db,
        limit: 1,
        pageSize: 1,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      const cleared = await ingestLocCollection({
        db,
        reset: true,
        limit: 1,
        pageSize: 1,
        autoResume: true,
        fetchImpl: multiPageFetch(),
        logger: silentLogger,
      });
      // After reset, the corpus is empty and the run starts back at page 1.
      expect(cleared.startPage).toBe(1);
      expect(cleared.written).toBe(1);
      const row = await db.execute(
        "SELECT next_page FROM ingest_progress WHERE source = 'loc'",
      );
      expect(Number(row.rows[0]?.next_page)).toBe(2);
    });
  });
});
