import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Database as DatabaseT } from 'better-sqlite3';

import {
  DocumentSentimentSchema,
  SentimentExtremesResponseSchema,
  SentimentTimelineResponseSchema,
  type Document,
} from '@tr/shared';

import { createApp } from '../app.js';
import { openInMemoryDatabase, upsertDocument } from '../db.js';

interface FixtureDoc {
  id: string;
  date: string;
  title: string;
}

const DOCS: FixtureDoc[] = [
  { id: 'doc-1899-a', date: '1899-03-01', title: 'Pre-1900 letter A' },
  { id: 'doc-1901-a', date: '1901-04-22', title: 'Post-1900 letter A' },
  { id: 'doc-1912-jan', date: '1912-01-10', title: '1912 January' },
  { id: 'doc-1912-jun', date: '1912-06-18', title: '1912 June rally speech' },
  { id: 'doc-1912-aug', date: '1912-08-30', title: '1912 August convention' },
  { id: 'doc-1912-oct', date: '1912-10-14', title: '1912 October aftermath' },
];

function baseDoc(fixture: FixtureDoc): Document {
  return {
    id: fixture.id,
    title: fixture.title,
    type: 'letter',
    date: fixture.date,
    recipient: 'Henry Cabot Lodge',
    location: null,
    author: 'Theodore Roosevelt',
    transcription: `Stub transcription for ${fixture.id}`,
    transcriptionUrl: null,
    transcriptionFormat: 'plain-text',
    facsimileUrl: null,
    iiifManifestUrl: null,
    provenance: null,
    source: 'Fixture',
    sourceUrl: null,
    tags: [],
    mentions: [],
    teiXml: null,
  };
}

const COMPUTED_AT = '2026-05-09T12:00:00Z';
const MODEL_VERSION = 'fixture:vader==3.3.2';

interface SentimentSeed {
  documentId: string;
  polarity: number;
  pos: number;
  neu: number;
  neg: number;
  label: 'positive' | 'neutral' | 'negative';
  sentenceCount: number;
}

const SEEDS: SentimentSeed[] = [
  { documentId: 'doc-1899-a', polarity: 0.2, pos: 0.3, neu: 0.6, neg: 0.1, label: 'positive', sentenceCount: 18 },
  { documentId: 'doc-1901-a', polarity: -0.1, pos: 0.15, neu: 0.7, neg: 0.15, label: 'neutral', sentenceCount: 22 },
  { documentId: 'doc-1912-jan', polarity: 0.55, pos: 0.4, neu: 0.55, neg: 0.05, label: 'positive', sentenceCount: 14 },
  { documentId: 'doc-1912-jun', polarity: 0.7, pos: 0.5, neu: 0.45, neg: 0.05, label: 'positive', sentenceCount: 30 },
  { documentId: 'doc-1912-aug', polarity: -0.4, pos: 0.1, neu: 0.5, neg: 0.4, label: 'negative', sentenceCount: 24 },
  { documentId: 'doc-1912-oct', polarity: -0.65, pos: 0.05, neu: 0.45, neg: 0.5, label: 'negative', sentenceCount: 20 },
];

function seedSentiment(db: DatabaseT): void {
  const insert = db.prepare(
    `INSERT INTO document_sentiment
       (document_id, polarity, pos, neu, neg, label, sentence_count, computed_at, model_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const s of SEEDS) {
      insert.run(s.documentId, s.polarity, s.pos, s.neu, s.neg, s.label, s.sentenceCount, COMPUTED_AT, MODEL_VERSION);
    }
  });
  tx();
}

describe('Sentiment API', () => {
  let db: DatabaseT;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    db = openInMemoryDatabase();
    for (const fixture of DOCS) {
      upsertDocument(db, baseDoc(fixture));
    }
    seedSentiment(db);
    app = createApp(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('GET /api/sentiment/timeline', () => {
    it('aggregates by month within a date range', async () => {
      const res = await request(app).get(
        '/api/sentiment/timeline?from=1912-01-01&to=1912-12-31&bin=month',
      );
      expect(res.status).toBe(200);
      const parsed = SentimentTimelineResponseSchema.parse(res.body);
      expect(parsed.bin).toBe('month');
      expect(parsed.points.map((p) => p.period)).toEqual(['1912-01', '1912-06', '1912-08', '1912-10']);
      const oct = parsed.points.find((p) => p.period === '1912-10');
      expect(oct?.meanPolarity).toBeCloseTo(-0.65, 5);
      expect(oct?.documentCount).toBe(1);
    });

    it('aggregates by year and excludes out-of-range docs', async () => {
      const res = await request(app).get(
        '/api/sentiment/timeline?from=1912-01-01&to=1912-12-31&bin=year',
      );
      expect(res.status).toBe(200);
      const parsed = SentimentTimelineResponseSchema.parse(res.body);
      expect(parsed.points).toHaveLength(1);
      expect(parsed.points[0]!.period).toBe('1912');
      expect(parsed.points[0]!.documentCount).toBe(4);
      const expected = (0.55 + 0.7 - 0.4 - 0.65) / 4;
      expect(parsed.points[0]!.meanPolarity).toBeCloseTo(expected, 5);
    });

    it('returns the full range when no dates given', async () => {
      const res = await request(app).get('/api/sentiment/timeline?bin=year');
      expect(res.status).toBe(200);
      const parsed = SentimentTimelineResponseSchema.parse(res.body);
      const periods = parsed.points.map((p) => p.period);
      expect(periods).toContain('1899');
      expect(periods).toContain('1901');
      expect(periods).toContain('1912');
    });

    it('rejects an unsupported bin with 400', async () => {
      const res = await request(app).get('/api/sentiment/timeline?bin=quarter');
      expect(res.status).toBe(400);
    });

    it('rejects malformed dates with 400', async () => {
      const res = await request(app).get('/api/sentiment/timeline?from=1912');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/sentiment/extremes', () => {
    it('returns most-positive and most-negative documents in range', async () => {
      const res = await request(app).get(
        '/api/sentiment/extremes?from=1912-01-01&to=1912-12-31&limit=2',
      );
      expect(res.status).toBe(200);
      const parsed = SentimentExtremesResponseSchema.parse(res.body);
      expect(parsed.mostPositive.map((d) => d.documentId)).toEqual(['doc-1912-jun', 'doc-1912-jan']);
      expect(parsed.mostNegative.map((d) => d.documentId)).toEqual(['doc-1912-oct', 'doc-1912-aug']);
    });
  });

  describe('GET /api/sentiment/documents/:id', () => {
    it('returns the per-document sentiment record', async () => {
      const res = await request(app).get('/api/sentiment/documents/doc-1912-jun');
      expect(res.status).toBe(200);
      const parsed = DocumentSentimentSchema.parse(res.body);
      expect(parsed.documentId).toBe('doc-1912-jun');
      expect(parsed.label).toBe('positive');
      expect(parsed.polarity).toBeCloseTo(0.7, 5);
    });

    it('returns 404 when the document has no sentiment record', async () => {
      const res = await request(app).get('/api/sentiment/documents/does-not-exist');
      expect(res.status).toBe(404);
    });
  });

  describe('OpenAPI', () => {
    it('registers the three sentiment endpoints', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.paths['/api/sentiment/timeline']).toBeDefined();
      expect(res.body.paths['/api/sentiment/extremes']).toBeDefined();
      expect(res.body.paths['/api/sentiment/documents/{id}']).toBeDefined();
    });
  });
});
