import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Database as DatabaseT } from 'better-sqlite3';

import { DocumentSchema, type Document } from '@tr/shared';

import { createApp } from '../app.js';
import { openInMemoryDatabase, upsertDocument } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSeed(): Document[] {
  const seedPath = join(__dirname, '..', '..', '..', 'data', 'seed.json');
  const raw = JSON.parse(readFileSync(seedPath, 'utf8')) as unknown;
  return DocumentSchema.array().parse(raw);
}

describe('TR Digital Library API', () => {
  let db: DatabaseT;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = openInMemoryDatabase();
    const seedDocs = loadSeed();
    // Inject deterministic transcription stubs so FTS tests don't need network access.
    // The token "alpenglow" is unique and lets us reliably exercise the highlighter.
    for (const doc of seedDocs) {
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
    it('lists all seeded documents', async () => {
      const res = await request(app).get('/api/documents');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(8);
      expect(res.body.items).toHaveLength(8);
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
      expect(res.body.paths['/api/search']).toBeDefined();
    });
  });
});
