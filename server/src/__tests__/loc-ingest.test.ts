import { DocumentSchema } from '@tr/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';


import { createApp } from '../app.js';
import { openInMemoryDatabase, type LibsqlClient } from '../db.js';
import {
  ingestLocCollection,
  mapLocItemToDocument,
  normalizeLocDate,
  type FetchLike,
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
};

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
});
