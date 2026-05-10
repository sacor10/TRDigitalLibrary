import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Database as DatabaseT } from 'better-sqlite3';

import { DocumentSchema, type Document } from '@tr/shared';

import { createApp } from '../app.js';
import { openInMemoryDatabase, upsertDocument } from '../db.js';
import { cloneTestDocuments, TEST_DOCUMENTS } from './fixtures/documents.js';

describe('TR Digital Library API', () => {
  let db: DatabaseT;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = openInMemoryDatabase();
    const fixtureDocs = cloneTestDocuments();
    // Inject deterministic transcription stubs so FTS tests don't need network access.
    // The token "alpenglow" is unique and lets us reliably exercise the highlighter.
    for (const doc of fixtureDocs) {
      upsertDocument(db, {
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

  describe('GET /api/documents', () => {
    it('lists all documents', async () => {
      const res = await request(app).get('/api/documents');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(TEST_DOCUMENTS.length);
      expect(res.body.items).toHaveLength(TEST_DOCUMENTS.length);
      // every item validates against the shared schema
      for (const item of res.body.items) {
        expect(() => DocumentSchema.parse(item)).not.toThrow();
      }
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

    it('rejects malformed query', async () => {
      const res = await request(app).get('/api/documents?dateFrom=not-a-date');
      expect(res.status).toBe(400);
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
      expect(() => DocumentSchema.parse(res.body)).not.toThrow();
    });

    it('round-trips iiifManifestUrl through the database', async () => {
      const manifest = 'https://iiif.archive.org/iiif/3/theroughriders00roosrich/manifest.json';
      upsertDocument(db, {
        ...TEST_DOCUMENTS[0]!,
        id: 'iiif-fixture',
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

    beforeAll(() => {
      const fixture = TEST_DOCUMENTS[0]!;
      upsertDocument(
        db,
        { ...fixture, id: fixtureId, transcription: 'original transcription text' },
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

      const historyRows = db
        .prepare(
          `SELECT field, previous_value, new_value, editor
           FROM document_field_provenance_history
           WHERE document_id = ? AND field = 'location'
           ORDER BY recorded_at DESC`,
        )
        .all(fixtureId) as Array<{
        field: string;
        previous_value: string;
        new_value: string;
        editor: string;
      }>;
      expect(historyRows.length).toBeGreaterThanOrEqual(1);
      const latest = historyRows[0]!;
      expect(latest.editor).toBe(editor);
      expect(JSON.parse(latest.new_value)).toBe('Sorbonne, Paris');
    });

    it('does not append history when the value is unchanged', async () => {
      const beforeRows = db
        .prepare(
          'SELECT COUNT(*) AS c FROM document_field_provenance_history WHERE document_id = ? AND field = ?',
        )
        .get(fixtureId, 'location') as { c: number };

      const res = await request(app)
        .patch(`/api/documents/${fixtureId}`)
        .set('X-Editor', 'jane.doe@example.org')
        .send({ location: 'Sorbonne, Paris' });
      expect(res.status).toBe(200);

      const afterRows = db
        .prepare(
          'SELECT COUNT(*) AS c FROM document_field_provenance_history WHERE document_id = ? AND field = ?',
        )
        .get(fixtureId, 'location') as { c: number };
      expect(afterRows.c).toBe(beforeRows.c);
    });
  });
});
