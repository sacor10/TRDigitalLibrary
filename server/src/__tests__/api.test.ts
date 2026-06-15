import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentSchema, type Document } from '@tr/shared';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';


import { createApp } from '../app.js';
import {
  locateMigrationsDir,
  openInMemoryDatabase,
  upsertDocument,
  type LibsqlClient,
} from '../db.js';

import { cloneTestDocuments, TEST_DOCUMENTS } from './fixtures/documents.js';

describe('TR Digital Library API', () => {
  let db: LibsqlClient;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await openInMemoryDatabase();
    const fixtureDocs = cloneTestDocuments();
    // Inject deterministic transcription stubs so FTS tests don't need network access.
    // The token "alpenglow" is unique and lets us reliably exercise the highlighter.
    for (const doc of fixtureDocs) {
      await upsertDocument(db, {
        ...doc,
        transcription: `Stub content for ${doc.title}. unique-token-alpenglow ${doc.id}.`,
      });
    }
    app = createApp(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('GET /api/health', () => {
    it('responds ok', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  // Regression guard for a Netlify 502: the esbuild-bundled lambda lives at
  // /var/task/netlify/functions/api.js, where __dirname collapses to /var/task
  // (the CJS bundle has no usable import.meta.url). The migration .sql files
  // are shipped at /var/task/server/src/migrations via `included_files`, so a
  // naive `readdirSync(join(__dirname, 'migrations'))` throws ENOENT at cold
  // start and the function 502s before serving a single request. The resolver
  // must walk a chain of fallback candidates.
  describe('locateMigrationsDir', () => {
    it('returns a directory containing the init migration', () => {
      const dir = locateMigrationsDir();
      expect(existsSync(join(dir, '001_init.sql'))).toBe(true);
    });
  });

  describe('GET /api/documents', () => {
    it('returns exactly 10 items by default and the full total', async () => {
      const res = await request(app).get('/api/documents');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(TEST_DOCUMENTS.length);
      expect(res.body.availableTypes).toEqual(
        [...new Set(TEST_DOCUMENTS.map((doc) => doc.type))].sort(),
      );
      expect(res.body.total).toBeGreaterThanOrEqual(10);
      expect(res.body.items).toHaveLength(10);
      for (const item of res.body.items) {
        expect(() => DocumentSchema.parse(item)).not.toThrow();
      }
    });

    it('returns available types for the full collection independent of pagination', async () => {
      const res = await request(app).get('/api/documents?type=speech&limit=1');
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].type).toBe('speech');
      expect(res.body.availableTypes).toEqual(
        [...new Set(TEST_DOCUMENTS.map((doc) => doc.type))].sort(),
      );
    });

    it('omits heavyweight document fields from list items', async () => {
      const res = await request(app).get('/api/documents');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.transcription).toBe('');
        expect(item.teiXml).toBeNull();
        expect(() => DocumentSchema.parse(item)).not.toThrow();
      }
    });

    it('honors explicit limit + offset for paging', async () => {
      const first = await request(app).get('/api/documents?limit=5&offset=0&sort=date&order=asc');
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(5);

      const second = await request(app).get('/api/documents?limit=5&offset=5&sort=date&order=asc');
      expect(second.status).toBe(200);
      expect(second.body.items).toHaveLength(5);

      const firstIds = new Set(first.body.items.map((d: Document) => d.id));
      for (const item of second.body.items) {
        expect(firstIds.has(item.id)).toBe(false);
      }
    });

    it('rejects limit above the 100 cap', async () => {
      const res = await request(app).get('/api/documents?limit=101');
      expect(res.status).toBe(400);
    });

    it('filters by type', async () => {
      const res = await request(app).get('/api/documents?type=speech');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.type).toBe('speech');
      }
    });

    it('filters by date range', async () => {
      const res = await request(app).get('/api/documents?dateFrom=1910-01-01&dateTo=1910-12-31');
      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(item.date >= '1910-01-01').toBe(true);
        expect(item.date <= '1910-12-31').toBe(true);
      }
    });

    it('filters by tag', async () => {
      const res = await request(app).get('/api/documents?tag=1910&limit=100');
      expect(res.status).toBe(200);
      const ids = res.body.items.map((d: Document) => d.id);
      expect(ids).toEqual(['man-in-the-arena', 'new-nationalism']);
      expect(res.body.total).toBe(2);
    });

    it('rejects malformed query', async () => {
      const res = await request(app).get('/api/documents?dateFrom=not-a-date');
      expect(res.status).toBe(400);
    });

    it('sorts ascending by date', async () => {
      const res = await request(app).get('/api/documents?sort=date&order=asc');
      expect(res.status).toBe(200);
      const dates = res.body.items.map((d: Document) => d.date);
      expect(dates).toEqual([...dates].sort());
    });

    it('returns 500 (not a hang) when the database errors', async () => {
      const brokenDb = {
        execute: async () => {
          throw new Error('simulated turso outage');
        },
        close: () => {},
      } as unknown as LibsqlClient;
      const brokenApp = createApp(brokenDb);
      const res = await request(brokenApp).get('/api/documents?sort=date&order=asc');
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/failed to list/i);
      expect(res.body.details).toContain('simulated turso outage');
    });

    // Regression guard for the 502 caused by an N+1 provenance fetch on the
    // list endpoint. With a 50-row default page the old code issued 52
    // round-trips to Turso and exceeded Netlify's 10s function timeout.
    it('uses a bounded number of db queries regardless of result size', async () => {
      let executeCount = 0;
      const countingDb = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === 'execute') {
            return async (...args: Parameters<LibsqlClient['execute']>) => {
              executeCount += 1;
              return (target.execute as LibsqlClient['execute'])(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as LibsqlClient;
      const countingApp = createApp(countingDb);
      const res = await request(countingApp).get('/api/documents?sort=date&order=asc');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      // Wave A (concurrent): COUNT + 2 facet aggregates + SELECT. Wave B: 1
      // batched IN-clause provenance fetch. 5 queries, 2 round-trip waves —
      // anything close to N+1 still trips this.
      expect(executeCount).toBeLessThanOrEqual(5);
    });
  });

  describe('GET /api/documents/:id', () => {
    it('returns 404 for unknown id', async () => {
      const res = await request(app).get('/api/documents/does-not-exist');
      expect(res.status).toBe(404);
    });

    it('returns the requested document', async () => {
      const res = await request(app).get('/api/documents/man-in-the-arena');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('man-in-the-arena');
      expect(res.body.transcription).toContain('Stub content for');
      expect(() => DocumentSchema.parse(res.body)).not.toThrow();
    });

    it('round-trips iiifManifestUrl through the database', async () => {
      const manifest = 'https://iiif.archive.org/iiif/3/theroughriders00roosrich/manifest.json';
      await upsertDocument(db, {
        ...TEST_DOCUMENTS[0]!,
        id: 'iiif-fixture',
        // The 008 migration added a partial UNIQUE INDEX on documents.source_url
        // (rejects duplicate non-null source URLs). The fixture rows already
        // populate the source_url space, so this synthetic row gets a null
        // sourceUrl to stay distinct.
        sourceUrl: null,
        iiifManifestUrl: manifest,
        transcription: 'fixture',
      });
      const res = await request(app).get('/api/documents/iiif-fixture');
      expect(res.status).toBe(200);
      expect(res.body.iiifManifestUrl).toBe(manifest);
    });

    it('returns null iiifManifestUrl when not set', async () => {
      const res = await request(app).get('/api/documents/man-in-the-arena');
      expect(res.status).toBe(200);
      expect(res.body.iiifManifestUrl).toBeNull();
    });
  });

  describe('GET /api/search', () => {
    it('rejects empty query', async () => {
      const res = await request(app).get('/api/search?q=');
      expect(res.status).toBe(400);
    });

    it('returns highlighted snippets for a matching token', async () => {
      const res = await request(app).get('/api/search?q=alpenglow');
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      const first = res.body.results[0];
      expect(first.snippet).toContain('<mark>');
      expect(first.snippet).toContain('</mark>');
      expect(() => DocumentSchema.parse(first.document)).not.toThrow();
    });

    it('omits heavyweight document fields from search result documents', async () => {
      const res = await request(app).get('/api/search?q=alpenglow');
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      for (const result of res.body.results) {
        expect(result.document.transcription).toBe('');
        expect(result.document.teiXml).toBeNull();
        expect(() => DocumentSchema.parse(result.document)).not.toThrow();
      }
    });

    it('matches title tokens via FTS', async () => {
      const res = await request(app).get('/api/search?q=arena');
      expect(res.status).toBe(200);
      expect(res.body.results.length).toBeGreaterThan(0);
      expect(res.body.results.some((r: { document: Document }) => r.document.id === 'man-in-the-arena')).toBe(
        true,
      );
    });

    it('combines query with type filter', async () => {
      const res = await request(app).get('/api/search?q=alpenglow&type=letter');
      expect(res.status).toBe(200);
      for (const r of res.body.results) {
        expect(r.document.type).toBe('letter');
      }
    });

    it('combines query with tag filter', async () => {
      const res = await request(app).get('/api/search?q=alpenglow&tag=1910&limit=100');
      expect(res.status).toBe(200);
      const ids = res.body.results.map((r: { document: Document }) => r.document.id).sort();
      expect(ids).toEqual(['man-in-the-arena', 'new-nationalism']);
      expect(res.body.total).toBe(2);
    });

    it('issues a ranking query (with COUNT OVER, no documents join) plus a rowid-scoped hydration query', async () => {
      // Regression guard for the perf properties of the two-phase search:
      //  1. The unbounded total piggybacks on the ranking query via COUNT(*)
      //     OVER (), so there is no separate COUNT round-trip.
      //  2. snippet()/transcription reads happen only in the hydration query
      //     and only against the page rowids — never against the full match
      //     set. If snippet() leaks into the ranking SELECT, every match
      //     materializes its transcription before LIMIT (the original 21s bug).
      //  3. On an unfiltered keyword search the ranking query must NOT join the
      //     documents table — the join forces a ~1MB-row PK lookup per match
      //     and is what pushed broad terms past the function timeout (504).
      const executeCalls: Array<{ sql: string; args?: unknown }> = [];
      const countingDb = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === 'execute') {
            return async (stmt: Parameters<LibsqlClient['execute']>[0]) => {
              if (typeof stmt === 'object' && stmt !== null && 'sql' in stmt) {
                const s = stmt as { sql: unknown; args?: unknown };
                executeCalls.push({ sql: String(s.sql), args: s.args });
              }
              return (target.execute as LibsqlClient['execute'])(stmt);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as LibsqlClient;
      const countingApp = createApp(countingDb);

      const res = await request(countingApp).get('/api/search?q=alpenglow&limit=5&offset=2');
      expect(res.status).toBe(200);

      const ftsCalls = executeCalls.filter((c) => c.sql.includes('documents_fts'));
      expect(ftsCalls).toHaveLength(4);

      const rankingCall = ftsCalls.find((c) => c.sql.includes('COUNT(*) OVER'));
      expect(rankingCall, 'ranking query should carry COUNT(*) OVER ()').toBeDefined();
      // Ranking query must not compute snippets; that's the whole point.
      expect(rankingCall!.sql).not.toContain('snippet(');
      // Unfiltered search: ranking runs on the FTS index alone, no documents join.
      expect(rankingCall!.sql).not.toMatch(/JOIN\s+documents/);

      const hydrateCall = ftsCalls.find((c) => c.sql.includes('snippet('));
      expect(hydrateCall, 'hydration query should exist').toBeDefined();
      expect(hydrateCall!.sql).toContain('documents.rowid IN');
      // Hydration is rowid-bound: args are positional [ftsQuery, ...rowids, ...rowids],
      // never @limit/@offset.
      expect(Array.isArray(hydrateCall!.args)).toBe(true);
      const hydrateArgs = hydrateCall!.args as unknown[];
      expect(hydrateArgs[0]).toBe('"alpenglow"');
      expect(hydrateArgs.length).toBeGreaterThan(1);

      const facetCalls = ftsCalls.filter((c) => c !== rankingCall && c !== hydrateCall);
      expect(facetCalls).toHaveLength(2);
      for (const facetCall of facetCalls) {
        expect(facetCall.sql).not.toContain('snippet(');
      }

      // Belt-and-braces: no separate COUNT(*) query survives.
      const standaloneCount = executeCalls.find((c) =>
        /\bSELECT\s+COUNT\(\*\)\s+as\s+c\b/i.test(c.sql),
      );
      expect(standaloneCount).toBeUndefined();
    });

    it('keeps the documents join in the ranking query when a documents.* filter is present', async () => {
      // The join is only droppable when nothing filters on a documents column.
      // With a type filter the ranking subquery must still join documents.
      const executeCalls: Array<{ sql: string }> = [];
      const countingDb = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === 'execute') {
            return async (stmt: Parameters<LibsqlClient['execute']>[0]) => {
              if (typeof stmt === 'object' && stmt !== null && 'sql' in stmt) {
                executeCalls.push({ sql: String((stmt as { sql: unknown }).sql) });
              }
              return (target.execute as LibsqlClient['execute'])(stmt);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as LibsqlClient;
      const countingApp = createApp(countingDb);

      const res = await request(countingApp).get('/api/search?q=alpenglow&type=letter');
      expect(res.status).toBe(200);
      const rankingCall = executeCalls.find((c) => c.sql.includes('COUNT(*) OVER'));
      expect(rankingCall, 'ranking query should exist').toBeDefined();
      expect(rankingCall!.sql).toMatch(/JOIN\s+documents/);
    });

    it('paginates via offset', async () => {
      const first = await request(app).get('/api/search?q=alpenglow&limit=10&offset=0');
      expect(first.status).toBe(200);
      expect(first.body.results).toHaveLength(10);

      const second = await request(app).get('/api/search?q=alpenglow&limit=10&offset=10');
      expect(second.status).toBe(200);
      expect(second.body.results.length).toBeGreaterThan(0);

      const firstIds = new Set(
        first.body.results.map((r: { document: Document }) => r.document.id),
      );
      for (const r of second.body.results) {
        expect(firstIds.has(r.document.id)).toBe(false);
      }
    });

    it('rejects limit above the 100 cap', async () => {
      const res = await request(app).get('/api/search?q=alpenglow&limit=101');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/openapi.json', () => {
    it('returns a valid OpenAPI 3.1 document', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.info.title).toBe('TR Digital Library API');
      expect(res.body.paths['/api/documents']).toBeDefined();
      expect(res.body.paths['/api/documents/{id}']).toBeDefined();
      expect(res.body.paths['/api/documents/{id}'].patch).toBeDefined();
      expect(res.body.paths['/api/search']).toBeDefined();
    });
  });

  describe('Provenance tracking', () => {
    const fixtureId = 'provenance-fixture';
    const fetchedAt = '2024-01-15T10:30:00.000Z';
    const sourceUrl = 'https://example.org/source';

    beforeAll(async () => {
      const fixture = TEST_DOCUMENTS[0]!;
      await upsertDocument(
        db,
        {
          ...fixture,
          id: fixtureId,
          // 008's partial UNIQUE INDEX on documents.source_url rejects
          // duplicates against the fixture rows seeded above. The provenance
          // ProvenanceContext.sourceUrl below is still tracked separately
          // in document_field_provenance, which is what these tests assert on.
          sourceUrl: null,
          transcription: 'original transcription text',
        },
        { sourceUrl, fetchedAt, editor: 'loc-ingest' },
      );
    });

    it('records origin URL, fetched-at, and editor for every tracked field on ingest', async () => {
      const res = await request(app).get(`/api/documents/${fixtureId}`);
      expect(res.status).toBe(200);
      expect(res.body.fieldProvenance).toBeDefined();
      const fp = res.body.fieldProvenance as Record<
        string,
        { sourceUrl: string | null; fetchedAt: string; editor: string }
      >;
      for (const field of [
        'title',
        'transcription',
        'source',
        'sourceUrl',
        'tags',
        'iiifManifestUrl',
      ]) {
        expect(fp[field]).toEqual({ sourceUrl, fetchedAt, editor: 'loc-ingest' });
      }
    });

    it('includes fieldProvenance in the list response for documents that have it', async () => {
      const res = await request(app).get('/api/documents?limit=100');
      expect(res.status).toBe(200);
      const fixture = res.body.items.find(
        (d: Document) => d.id === fixtureId,
      );
      expect(fixture).toBeDefined();
      expect(fixture.fieldProvenance).toBeDefined();
      expect(fixture.fieldProvenance.title).toEqual({
        sourceUrl,
        fetchedAt,
        editor: 'loc-ingest',
      });
    });

    it('rejects PATCH without X-Editor header', async () => {
      const res = await request(app)
        .patch(`/api/documents/${fixtureId}`)
        .send({ location: 'New location' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/X-Editor/i);
    });

    it('rejects PATCH with empty body', async () => {
      const res = await request(app)
        .patch(`/api/documents/${fixtureId}`)
        .set('X-Editor', 'jane.doe@example.org')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for PATCH on unknown id', async () => {
      const res = await request(app)
        .patch('/api/documents/does-not-exist')
        .set('X-Editor', 'jane.doe@example.org')
        .send({ location: 'Anywhere' });
      expect(res.status).toBe(404);
    });

    it('updates field, records editor in provenance, and appends history', async () => {
      const editor = 'jane.doe@example.org';
      const res = await request(app)
        .patch(`/api/documents/${fixtureId}`)
        .set('X-Editor', editor)
        .send({ location: 'Sorbonne, Paris' });

      expect(res.status).toBe(200);
      expect(res.body.location).toBe('Sorbonne, Paris');
      expect(res.body.fieldProvenance.location.editor).toBe(editor);
      expect(res.body.fieldProvenance.location.sourceUrl).toBeNull();
      expect(typeof res.body.fieldProvenance.location.fetchedAt).toBe('string');
      // Untouched fields keep their ingest-time provenance.
      expect(res.body.fieldProvenance.title.editor).toBe('loc-ingest');
      expect(() => DocumentSchema.parse(res.body)).not.toThrow();

      const historyResult = await db.execute({
        sql: `SELECT field, previous_value, new_value, editor
              FROM document_field_provenance_history
              WHERE document_id = ? AND field = 'location'
              ORDER BY recorded_at DESC`,
        args: [fixtureId],
      });
      expect(historyResult.rows.length).toBeGreaterThanOrEqual(1);
      const latest = historyResult.rows[0]!;
      expect(String(latest.editor)).toBe(editor);
      expect(JSON.parse(String(latest.new_value))).toBe('Sorbonne, Paris');
    });

    it('does not append history when the value is unchanged', async () => {
      const beforeResult = await db.execute({
        sql: 'SELECT COUNT(*) AS c FROM document_field_provenance_history WHERE document_id = ? AND field = ?',
        args: [fixtureId, 'location'],
      });
      const beforeCount = Number(beforeResult.rows[0]?.c ?? 0);

      const res = await request(app)
        .patch(`/api/documents/${fixtureId}`)
        .set('X-Editor', 'jane.doe@example.org')
        .send({ location: 'Sorbonne, Paris' });
      expect(res.status).toBe(200);

      const afterResult = await db.execute({
        sql: 'SELECT COUNT(*) AS c FROM document_field_provenance_history WHERE document_id = ? AND field = ?',
        args: [fixtureId, 'location'],
      });
      const afterCount = Number(afterResult.rows[0]?.c ?? 0);
      expect(afterCount).toBe(beforeCount);
    });
  });
});
