import {
  TopicDetailResponseSchema,
  TopicDriftResponseSchema,
  TopicsResponseSchema,
  type Document,
} from '@tr/shared';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { createApp } from '../app.js';
import { openInMemoryDatabase, upsertDocument, type LibsqlClient } from '../db.js';

interface FixtureDoc {
  id: string;
  date: string;
  title: string;
  tags: string[];
}

// Designed so:
//  - "conservation" tag spans 1899/1901/1912 (drift across periods)
//  - "progressive" tag is post-1900 only (asserts absence in 1899)
//  - "family" tag covers a single document (size 1)
//  - "corpus-global" mimics LoC collection-wide headings and should be hidden
const DOCS: FixtureDoc[] = [
  {
    id: 'doc-1899-a',
    date: '1899-03-01',
    title: 'Pre-1900 letter A',
    tags: ['corpus-global', 'conservation', 'conservation', 'family'],
  },
  {
    id: 'doc-1899-b',
    date: '1899-09-12',
    title: 'Pre-1900 letter B',
    tags: ['corpus-global', 'conservation'],
  },
  {
    id: 'doc-1899-c',
    date: '1899-11-04',
    title: 'Pre-1900 letter C',
    tags: ['corpus-global', 'navy'],
  },
  {
    id: 'doc-1901-a',
    date: '1901-04-22',
    title: 'Post-1900 letter A',
    tags: ['corpus-global', 'conservation', 'progressive'],
  },
  {
    id: 'doc-1901-b',
    date: '1901-07-15',
    title: 'Post-1900 letter B',
    tags: ['corpus-global', 'navy'],
  },
  {
    id: 'doc-1912-a',
    date: '1912-06-18',
    title: '1912 campaign A',
    tags: ['corpus-global', 'conservation', 'progressive'],
  },
  {
    id: 'doc-1912-b',
    date: '1912-08-30',
    title: '1912 campaign B',
    tags: ['corpus-global', 'navy'],
  },
  {
    id: 'doc-1912-c',
    date: '1912-10-14',
    title: '1912 campaign C',
    tags: ['corpus-global', 'progressive'],
  },
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
    tags: fixture.tags,
    mentions: [],
    teiXml: null,
  };
}

describe('Topics API', () => {
  let db: LibsqlClient;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await openInMemoryDatabase();
    for (const fixture of DOCS) {
      await upsertDocument(db, baseDoc(fixture));
    }
    app = createApp(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('GET /api/topics', () => {
    it('aggregates tags into topics ordered by size DESC', async () => {
      const res = await request(app).get('/api/topics');
      expect(res.status).toBe(200);
      const parsed = TopicsResponseSchema.parse(res.body);
      // 4 visible tags: conservation, navy, progressive, family. The
      // corpus-global tag applies to every document and is hidden.
      expect(parsed.total).toBe(4);
      const sizes = parsed.items.map((t) => t.size);
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
      expect(parsed.items.map((t) => t.id)).not.toContain('corpus-global');
      expect(parsed.items[0]!.size).toBe(4); // conservation, counted by distinct document
      expect(parsed.items[0]!.id).toBe('conservation');
      expect(parsed.items[parsed.items.length - 1]!.size).toBe(1); // family
    });

    it('hides corpus-wide tags instead of treating them as topics', async () => {
      const globalOnlyDb = await openInMemoryDatabase();
      try {
        await upsertDocument(
          globalOnlyDb,
          baseDoc({
            id: 'global-a',
            date: '1901-01-01',
            title: 'Global A',
            tags: ['same-topic'],
          }),
        );
        await upsertDocument(
          globalOnlyDb,
          baseDoc({
            id: 'global-b',
            date: '1902-01-01',
            title: 'Global B',
            tags: ['same-topic'],
          }),
        );
        const globalOnlyApp = createApp(globalOnlyDb);
        const res = await request(globalOnlyApp).get('/api/topics');
        expect(res.status).toBe(200);
        const parsed = TopicsResponseSchema.parse(res.body);
        expect(parsed.items).toEqual([]);

        const detail = await request(globalOnlyApp).get('/api/topics/same-topic');
        expect(detail.status).toBe(404);

        const drift = await request(globalOnlyApp).get('/api/topics/drift');
        expect(drift.status).toBe(200);
        expect(TopicDriftResponseSchema.parse(drift.body).points).toHaveLength(0);
      } finally {
        globalOnlyDb.close();
      }
    });
  });

  describe('GET /api/topics/:id', () => {
    it('returns the topic plus its members in date-desc order', async () => {
      const res = await request(app).get('/api/topics/conservation');
      expect(res.status).toBe(200);
      const parsed = TopicDetailResponseSchema.parse(res.body);
      expect(parsed.topic.id).toBe('conservation');
      expect(parsed.topic.size).toBe(4);
      expect(parsed.total).toBe(4);
      expect(parsed.limit).toBe(25);
      expect(parsed.offset).toBe(0);
      expect(parsed.members.length).toBe(4);
      const dates = parsed.members.map((m) => m.date);
      expect(dates).toEqual([...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
      for (const m of parsed.members) {
        expect(m.title.length).toBeGreaterThan(0);
        expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('caps member count to the requested limit', async () => {
      const res = await request(app).get('/api/topics/conservation?limit=2');
      expect(res.status).toBe(200);
      const parsed = TopicDetailResponseSchema.parse(res.body);
      expect(parsed.members).toHaveLength(2);
      expect(parsed.total).toBe(4);
      expect(parsed.limit).toBe(2);
      expect(parsed.offset).toBe(0);
    });

    it('returns member pages from the requested offset', async () => {
      const first = await request(app).get('/api/topics/conservation?limit=2&offset=0');
      const second = await request(app).get('/api/topics/conservation?limit=2&offset=2');
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstParsed = TopicDetailResponseSchema.parse(first.body);
      const secondParsed = TopicDetailResponseSchema.parse(second.body);
      expect(firstParsed.members).toHaveLength(2);
      expect(secondParsed.members).toHaveLength(2);
      expect(secondParsed.offset).toBe(2);
      expect(secondParsed.members.map((m) => m.documentId)).not.toEqual(
        firstParsed.members.map((m) => m.documentId),
      );
    });

    it('returns 404 for an unknown tag', async () => {
      const res = await request(app).get('/api/topics/no-such-tag');
      expect(res.status).toBe(404);
    });

    it('returns 404 for a suppressed corpus-global tag', async () => {
      const res = await request(app).get('/api/topics/corpus-global');
      expect(res.status).toBe(404);
    });

    it('decodes URL-encoded tag values', async () => {
      // Add a doc with a tag containing a space + comma (LoC subject-heading style).
      await upsertDocument(
        db,
        baseDoc({
          id: 'doc-encoded',
          date: '1905-01-01',
          title: 'Encoded tag fixture',
          tags: ['corpus-global', 'Politics and government'],
        }),
      );
      const encoded = encodeURIComponent('Politics and government');
      const res = await request(app).get(`/api/topics/${encoded}`);
      expect(res.status).toBe(200);
      expect(res.body.topic.id).toBe('Politics and government');
      expect(res.body.topic.size).toBe(1);
    });
  });

  describe('GET /api/topics/drift', () => {
    it('excludes corpus-global topics and uses distinct yearly documents as share denominator', async () => {
      const res = await request(app).get('/api/topics/drift');
      expect(res.status).toBe(200);
      const parsed = TopicDriftResponseSchema.parse(res.body);
      expect(parsed.points.map((p) => p.topicId)).not.toContain('corpus-global');
      const conservation1899 = parsed.points.find(
        (p) => p.topicId === 'conservation' && p.period === '1899',
      );
      expect(conservation1899?.documentCount).toBe(2);
      expect(conservation1899?.share).toBeCloseTo(2 / 3, 5);
    });

    it('reports zero presence for the progressive tag in 1899', async () => {
      const res = await request(app).get('/api/topics/drift');
      expect(res.status).toBe(200);
      const parsed = TopicDriftResponseSchema.parse(res.body);
      const progressive = parsed.points.filter((p) => p.topicId === 'progressive');
      expect(progressive.length).toBeGreaterThan(0);
      const periods = progressive.map((p) => p.period);
      expect(periods).not.toContain('1899');
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
      expect(res.body.paths['/api/topics/status']).toBeUndefined();
    });
  });
});
