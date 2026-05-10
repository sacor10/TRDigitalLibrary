import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database as DatabaseT } from 'better-sqlite3';

import { DocumentSchema } from '@tr/shared';

import { createApp } from '../app.js';
import { openInMemoryDatabase } from '../db.js';
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
  let db: DatabaseT | null = null;

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
    db = openInMemoryDatabase();
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
    const count = db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('ingests LoC text into the existing document and FTS search APIs', async () => {
    db = openInMemoryDatabase();
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
