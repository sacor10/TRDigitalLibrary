import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { InStatement } from '@libsql/client';

import {
  TopicDetailResponseSchema,
  TopicDriftResponseSchema,
  TopicsResponseSchema,
  type Document,
} from '@tr/shared';

import { createApp } from '../app.js';
import { openInMemoryDatabase, upsertDocument, type LibsqlClient } from '../db.js';

interface FixtureDoc {
  id: string;
  date: string;
  title: string;
}

const DOCS: FixtureDoc[] = [
  { id: 'doc-1899-a', date: '1899-03-01', title: 'Pre-1900 letter A' },
  { id: 'doc-1899-b', date: '1899-09-12', title: 'Pre-1900 letter B' },
  { id: 'doc-1899-c', date: '1899-11-04', title: 'Pre-1900 letter C' },
  { id: 'doc-1901-a', date: '1901-04-22', title: 'Post-1900 letter A' },
  { id: 'doc-1901-b', date: '1901-07-15', title: 'Post-1900 letter B' },
  { id: 'doc-1912-a', date: '1912-06-18', title: '1912 campaign A' },
  { id: 'doc-1912-b', date: '1912-08-30', title: '1912 campaign B' },
  { id: 'doc-1912-c', date: '1912-10-14', title: '1912 campaign C' },
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
const MODEL_VERSION = 'fixture:sentence-transformers==2.7';

interface TopicSeed {
  id: number;
  label: string;
  keywords: string[];
  members: { documentId: string; probability: number }[];
}

const TOPIC_SEEDS: TopicSeed[] = [
  {
    id: 0,
    label: 'conservation, parks, forest',
    keywords: ['conservation', 'parks', 'forest', 'wildlife', 'land'],
    members: [
      { documentId: 'doc-1899-a', probability: 0.92 },
      { documentId: 'doc-1899-b', probability: 0.85 },
      { documentId: 'doc-1901-a', probability: 0.71 },
      { documentId: 'doc-1912-a', probability: 0.66 },
    ],
  },
  {
    id: 1,
    label: 'navy, fleet, battleship',
    keywords: ['navy', 'fleet', 'battleship'],
    members: [
      { documentId: 'doc-1899-c', probability: 0.88 },
      { documentId: 'doc-1901-b', probability: 0.74 },
      { documentId: 'doc-1912-b', probability: 0.5 },
    ],
  },
  {
    // post-1900-only topic — drives the drift acceptance test
    id: 2,
    label: 'progressive, party, primary',
    keywords: ['progressive', 'party', 'primary'],
    members: [
      { documentId: 'doc-1901-a', probability: 0.4 },
      { documentId: 'doc-1912-a', probability: 0.95 },
      { documentId: 'doc-1912-c', probability: 0.93 },
    ],
  },
  {
    id: 3,
    label: 'family, children, sagamore',
    keywords: ['family', 'children', 'sagamore'],
    members: [{ documentId: 'doc-1899-a', probability: 0.3 }],
  },
];

async function seedTopics(db: LibsqlClient): Promise<void> {
  const stmts: InStatement[] = [];

  // Total docs per period across all topics (deduplicated by document).
  const docsPerPeriod = new Map<string, Set<string>>();
  for (const seed of TOPIC_SEEDS) {
    for (const m of seed.members) {
      const fixture = DOCS.find((d) => d.id === m.documentId);
      if (!fixture) continue;
      const period = fixture.date.slice(0, 4);
      if (!docsPerPeriod.has(period)) docsPerPeriod.set(period, new Set());
      docsPerPeriod.get(period)!.add(m.documentId);
    }
  }

  for (const seed of TOPIC_SEEDS) {
    stmts.push({
      sql: 'INSERT INTO topics (id, label, keywords, size, computed_at, model_version) VALUES (?, ?, ?, ?, ?, ?)',
      args: [
        seed.id,
        seed.label,
        JSON.stringify(seed.keywords),
        seed.members.length,
        COMPUTED_AT,
        MODEL_VERSION,
      ],
    });
    for (const m of seed.members) {
      stmts.push({
        sql: 'INSERT INTO document_topics (document_id, topic_id, probability) VALUES (?, ?, ?)',
        args: [m.documentId, seed.id, m.probability],
      });
    }
    // drift = (docs in topic for that period) / (total docs in any topic for that period)
    const perTopicPeriodCounts = new Map<string, number>();
    for (const m of seed.members) {
      const fixture = DOCS.find((d) => d.id === m.documentId);
      if (!fixture) continue;
      const period = fixture.date.slice(0, 4);
      perTopicPeriodCounts.set(period, (perTopicPeriodCounts.get(period) ?? 0) + 1);
    }
    for (const [period, count] of perTopicPeriodCounts) {
      const totalForPeriod = docsPerPeriod.get(period)?.size ?? 0;
      const share = totalForPeriod > 0 ? count / totalForPeriod : 0;
      stmts.push({
        sql: 'INSERT INTO topic_drift (topic_id, period, document_count, share) VALUES (?, ?, ?, ?)',
        args: [seed.id, period, count, share],
      });
    }
  }

  await db.batch(stmts, 'write');
}

describe('Topics API', () => {
  let db: LibsqlClient;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await openInMemoryDatabase();
    for (const fixture of DOCS) {
      await upsertDocument(db, baseDoc(fixture));
    }
    await seedTopics(db);
    app = createApp(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('GET /api/topics', () => {
    it('returns all topics ordered by size DESC', async () => {
      const res = await request(app).get('/api/topics');
      expect(res.status).toBe(200);
      const parsed = TopicsResponseSchema.parse(res.body);
      expect(parsed.total).toBe(4);
      const sizes = parsed.items.map((t) => t.size);
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      expect(parsed.items[0]!.size).toBe(4);
      expect(parsed.items[parsed.items.length - 1]!.size).toBe(1);
      expect(parsed.items[0]!.keywords.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/topics/:id', () => {
    it('returns the topic plus its members in probability-desc order', async () => {
      const res = await request(app).get('/api/topics/0');
      expect(res.status).toBe(200);
      const parsed = TopicDetailResponseSchema.parse(res.body);
      expect(parsed.topic.id).toBe(0);
      expect(parsed.members.length).toBe(4);
      const probs = parsed.members.map((m) => m.probability);
      expect(probs).toEqual([...probs].sort((a, b) => b - a));
      // Members include joined title + date from the documents table.
      for (const m of parsed.members) {
        expect(m.title.length).toBeGreaterThan(0);
        expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('caps member count to the requested limit', async () => {
      const res = await request(app).get('/api/topics/0?limit=2');
      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(2);
    });

    it('returns 404 for unknown topic id', async () => {
      const res = await request(app).get('/api/topics/999');
      expect(res.status).toBe(404);
    });

    it('returns 400 for malformed topic id', async () => {
      const res = await request(app).get('/api/topics/not-a-number');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/topics/drift', () => {
    it('returns drift points whose per-period shares sum to <= 1', async () => {
      const res = await request(app).get('/api/topics/drift');
      expect(res.status).toBe(200);
      const parsed = TopicDriftResponseSchema.parse(res.body);
      const sumByPeriod = new Map<string, number>();
      for (const point of parsed.points) {
        sumByPeriod.set(point.period, (sumByPeriod.get(point.period) ?? 0) + point.share);
      }
      for (const [, total] of sumByPeriod) {
        expect(total).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it('reports zero presence for the post-1900 topic in the 1899 period', async () => {
      const res = await request(app).get('/api/topics/drift');
      expect(res.status).toBe(200);
      const parsed = TopicDriftResponseSchema.parse(res.body);
      const post1900 = parsed.points.filter((p) => p.topicId === 2);
      expect(post1900.length).toBeGreaterThan(0);
      const periods = post1900.map((p) => p.period);
      expect(periods).not.toContain('1899');
      // ...and it has presence in 1901 and 1912.
      expect(periods).toContain('1901');
      expect(periods).toContain('1912');
    });

    it('rejects an unsupported bin granularity with 400', async () => {
      const res = await request(app).get('/api/topics/drift?bin=quarter');
      expect(res.status).toBe(400);
    });

    it('accepts the explicit `year` bin', async () => {
      const res = await request(app).get('/api/topics/drift?bin=year');
      expect(res.status).toBe(200);
    });
  });

  describe('OpenAPI', () => {
    it('registers the three topic endpoints', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.paths['/api/topics']).toBeDefined();
      expect(res.body.paths['/api/topics/{id}']).toBeDefined();
      expect(res.body.paths['/api/topics/drift']).toBeDefined();
    });
  });
});
