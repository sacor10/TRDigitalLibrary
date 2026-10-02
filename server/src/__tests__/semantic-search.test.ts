import express, { json } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openInMemoryDatabase, upsertDocument, type LibsqlClient } from '../db.js';
import { encodeEmbedding } from '../embeddings/vector.js';
import { createSearchRouter } from '../routes/search.js';

import { TEST_DOCUMENTS } from './fixtures/documents.js';

// A shared lexical token so all three seeded docs match the FTS query; the
// embeddings then determine the semantic re-ranking order.
const TOKEN = 'conservation';

function makeApp(db: LibsqlClient, queryVec: Float32Array | null) {
  const app = express();
  app.use(json());
  app.use('/api/search', createSearchRouter(db, { embedQuery: async () => queryVec }));
  return app;
}

describe('semantic / hybrid search re-ranking', () => {
  let db: LibsqlClient;

  beforeAll(async () => {
    db = await openInMemoryDatabase();
    const base = TEST_DOCUMENTS[0]!;
    const seed = [
      { id: 'sem-a', emb: [0, 1, 0, 0] },
      { id: 'sem-b', emb: [1, 0, 0, 0] },
      { id: 'sem-c', emb: [0.7, 0.7, 0, 0] },
    ];
    for (const { id, emb } of seed) {
      await upsertDocument(db, {
        ...base,
        id,
        title: `Doc ${id}`,
        sourceUrl: null,
        transcription: `A document about ${TOKEN} and the badlands. ${id}`,
      });
      await db.execute({
        sql: `INSERT INTO document_embeddings (document_id, embedding, dim, model_version, computed_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [id, encodeEmbedding(Float32Array.from(emb)), 4, 'test-model', new Date().toISOString()],
      });
    }
  });

  afterAll(() => db.close());

  it('orders semantic results by cosine similarity to the query vector', async () => {
    // Query vector [1,0,0,0] is closest to sem-b, then sem-c, then sem-a.
    const app = makeApp(db, Float32Array.from([1, 0, 0, 0]));
    const res = await request(app).get(`/api/search?q=${TOKEN}&mode=semantic&limit=10`);
    expect(res.status).toBe(200);
    const ids = res.body.results.map((r: { document: { id: string } }) => r.document.id);
    expect(ids).toEqual(['sem-b', 'sem-c', 'sem-a']);
    for (const result of res.body.results) {
      expect(result.mode).toBe('semantic');
      expect(typeof result.score).toBe('number');
    }
  });

  it('blends lexical and semantic signals in hybrid mode', async () => {
    const app = makeApp(db, Float32Array.from([1, 0, 0, 0]));
    const res = await request(app).get(`/api/search?q=${TOKEN}&mode=hybrid&alpha=0&limit=10`);
    expect(res.status).toBe(200);
    // alpha=0 → pure semantic weighting → sem-b ranks first.
    expect(res.body.results[0].document.id).toBe('sem-b');
    expect(res.body.results[0].mode).toBe('hybrid');
  });

  it('falls back to lexical (no error, no scores) when the embedder is unavailable', async () => {
    const app = makeApp(db, null);
    const res = await request(app).get(`/api/search?q=${TOKEN}&mode=hybrid&limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].mode).toBeUndefined();
    expect(res.body.results[0].score).toBeUndefined();
  });
});
