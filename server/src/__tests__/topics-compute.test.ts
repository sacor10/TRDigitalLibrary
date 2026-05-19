import { type Document } from '@tr/shared';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';


import { openInMemoryDatabase, upsertDocument, type LibsqlClient } from '../db.js';
import { computeTopics, TOPIC_MODEL_VERSION } from '../topics/compute.js';
import { _resetComputeStatusForTests, ensureTopicsComputed, getComputeStatus, shouldRecompute } from '../topics/ensure.js';

// 16 fixture docs across three themes. Same-theme docs share keywords so the
// c-TF-IDF stage can produce a meaningful label without a real corpus.
interface FixtureDoc {
  id: string;
  date: string;
  theme: 0 | 1 | 2;
  text: string;
}

const DOCS: FixtureDoc[] = [
  { id: 'cons-1', date: '1899-04-12', theme: 0, text: 'conservation of forests and wildlife is essential for the nation. national parks protect our natural heritage.' },
  { id: 'cons-2', date: '1900-06-08', theme: 0, text: 'forest reserves and conservation policy. national parks must be protected from logging interests.' },
  { id: 'cons-3', date: '1901-09-19', theme: 0, text: 'wildlife conservation requires federal forest management. national parks and reserves expand.' },
  { id: 'cons-4', date: '1903-05-21', theme: 0, text: 'conservation movement gains support. forest service protects wildlife in expanded national parks.' },
  { id: 'cons-5', date: '1905-11-02', theme: 0, text: 'parks and forests are the heritage of every citizen. conservation policy must guard against rapacious logging.' },
  { id: 'cons-6', date: '1908-03-14', theme: 0, text: 'wildlife and forests must be conserved. national parks expand under federal conservation policy.' },
  { id: 'navy-1', date: '1898-02-15', theme: 1, text: 'the navy must build a modern fleet of battleships. naval expansion is crucial to power projection.' },
  { id: 'navy-2', date: '1899-10-04', theme: 1, text: 'fleet expansion continues. new battleships strengthen the navy and naval power.' },
  { id: 'navy-3', date: '1902-04-30', theme: 1, text: 'modern naval forces protect commerce. fleet of battleships represents naval strength.' },
  { id: 'navy-4', date: '1906-08-17', theme: 1, text: 'great white fleet circumnavigates the globe. naval power signals national strength.' },
  { id: 'navy-5', date: '1909-01-22', theme: 1, text: 'navy fleet modernization continues. battleships and cruisers form the new naval force.' },
  { id: 'pol-1', date: '1904-07-04', theme: 2, text: 'progressive party platform calls for primaries and direct election. political reform of party machines.' },
  { id: 'pol-2', date: '1910-09-15', theme: 2, text: 'progressive movement demands primaries. party reform and direct election of senators.' },
  { id: 'pol-3', date: '1912-06-22', theme: 2, text: 'progressive party convention. primary reform sweeps the country and breaks party bosses.' },
  { id: 'pol-4', date: '1912-08-30', theme: 2, text: 'campaign for progressive primaries. political reform of corrupt party machinery.' },
  { id: 'pol-5', date: '1912-10-14', theme: 2, text: 'progressive party rally. direct primary will reshape political party platforms.' },
];

function baseDoc(fixture: FixtureDoc): Document {
  return {
    id: fixture.id,
    title: `Letter ${fixture.id}`,
    type: 'letter',
    date: fixture.date,
    recipient: 'Henry Cabot Lodge',
    location: null,
    author: 'Theodore Roosevelt',
    transcription: fixture.text,
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

// Deterministic seedable RNG; mulberry32.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each theme gets a base 384-dim unit vector; each doc is base + small noise,
// renormalized to unit length. K-means with cosine distance should recover
// the three themes cleanly.
function buildFakeEmbedder(): (texts: string[]) => Promise<Float32Array[]> {
  const DIM = 384;
  const rng = mulberry32(7);
  const themeBases: Float32Array[] = [];
  for (let t = 0; t < 3; t++) {
    const v = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) v[i] = rng() * 2 - 1;
    let n = 0;
    for (let i = 0; i < DIM; i++) n += v[i]! * v[i]!;
    n = Math.sqrt(n);
    for (let i = 0; i < DIM; i++) v[i] = v[i]! / n;
    themeBases.push(v);
  }
  // Look up theme by exact transcription text.
  const themeByText = new Map<string, number>();
  for (const d of DOCS) themeByText.set(d.text, d.theme);

  return async (texts: string[]) => {
    const out: Float32Array[] = [];
    for (const text of texts) {
      const theme = themeByText.get(text) ?? 0;
      const base = themeBases[theme]!;
      const v = new Float32Array(DIM);
      for (let i = 0; i < DIM; i++) v[i] = base[i]! + (rng() * 0.04 - 0.02);
      let n = 0;
      for (let i = 0; i < DIM; i++) n += v[i]! * v[i]!;
      n = Math.sqrt(n);
      for (let i = 0; i < DIM; i++) v[i] = v[i]! / n;
      out.push(v);
    }
    return out;
  };
}

async function seedDocs(db: LibsqlClient, docs: FixtureDoc[]): Promise<void> {
  for (const d of docs) {
    await upsertDocument(db, baseDoc(d));
  }
}

describe('topics auto-compute', () => {
  let db: LibsqlClient;

  beforeEach(async () => {
    _resetComputeStatusForTests();
    db = await openInMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('clusters a seeded corpus into >=2 topics with member documents and drift rows', async () => {
    await seedDocs(db, DOCS);
    const result = await computeTopics(db, { embed: buildFakeEmbedder() });
    expect(result).not.toBeNull();
    expect(result!.documentCount).toBe(DOCS.length);
    expect(result!.topicCount).toBeGreaterThanOrEqual(2);

    const topics = await db.execute('SELECT id, label, keywords, size, model_version FROM topics ORDER BY size DESC');
    expect(topics.rows.length).toBe(result!.topicCount);
    for (const row of topics.rows) {
      expect(String(row.label).length).toBeGreaterThan(0);
      const kws = JSON.parse(String(row.keywords)) as string[];
      expect(kws.length).toBeGreaterThan(0);
      expect(Number(row.size)).toBeGreaterThan(0);
      expect(String(row.model_version)).toBe(TOPIC_MODEL_VERSION);
    }

    // Every doc lands in exactly one topic (k-means assigns all docs).
    const docTopics = await db.execute('SELECT COUNT(*) AS c FROM document_topics');
    expect(Number(docTopics.rows[0]!.c)).toBe(DOCS.length);

    // Drift rows exist and per-period shares sum to ~1 (k-means leaves no noise).
    const drift = await db.execute('SELECT topic_id, period, document_count, share FROM topic_drift');
    expect(drift.rows.length).toBeGreaterThan(0);
    const sumByPeriod = new Map<string, number>();
    for (const row of drift.rows) {
      const period = String(row.period);
      sumByPeriod.set(period, (sumByPeriod.get(period) ?? 0) + Number(row.share));
    }
    for (const [, sum] of sumByPeriod) {
      expect(sum).toBeGreaterThan(0.99);
      expect(sum).toBeLessThanOrEqual(1.001);
    }

    // Meta row reflects the inputs to this run.
    const meta = await db.execute('SELECT document_count, model_version FROM topic_compute_meta WHERE id = 1');
    expect(meta.rows.length).toBe(1);
    expect(Number(meta.rows[0]!.document_count)).toBe(DOCS.length);
    expect(String(meta.rows[0]!.model_version)).toBe(TOPIC_MODEL_VERSION);
  });

  it('groups documents from the same theme into the same cluster', async () => {
    await seedDocs(db, DOCS);
    await computeTopics(db, { embed: buildFakeEmbedder() });
    const result = await db.execute('SELECT document_id, topic_id FROM document_topics');
    const topicByDoc = new Map<string, number>();
    for (const row of result.rows) {
      topicByDoc.set(String(row.document_id), Number(row.topic_id));
    }
    // For each theme, all docs in that theme must share a topic id.
    for (const theme of [0, 1, 2] as const) {
      const themeDocs = DOCS.filter((d) => d.theme === theme);
      const topicIds = new Set(themeDocs.map((d) => topicByDoc.get(d.id)!));
      expect(topicIds.size).toBe(1);
    }
  });

  it('ensureTopicsComputed reports ready and skips recompute on the second call with unchanged docs', async () => {
    await seedDocs(db, DOCS);
    await ensureTopicsComputed(db, { embed: buildFakeEmbedder(), await: true });
    const firstStatus = getComputeStatus();
    expect(firstStatus.status).toBe('ready');
    expect(firstStatus.documentCount).toBe(DOCS.length);

    const firstComputedAt = firstStatus.computedAt;
    // Second call -- meta is fresh and doc count is unchanged, so no recompute.
    await ensureTopicsComputed(db, { embed: buildFakeEmbedder(), await: true });
    const secondStatus = getComputeStatus();
    expect(secondStatus.status).toBe('ready');
    expect(secondStatus.computedAt).toBe(firstComputedAt);
  });

  it('returns null and stays idle when documents table is empty', async () => {
    const result = await computeTopics(db, { embed: buildFakeEmbedder() });
    expect(result).toBeNull();
    await ensureTopicsComputed(db, { embed: buildFakeEmbedder(), await: true });
    const status = getComputeStatus();
    expect(status.status).toBe('idle');
    expect(status.documentCount).toBe(0);
  });

  it('exposes status via GET /api/topics/status', async () => {
    await seedDocs(db, DOCS);
    await ensureTopicsComputed(db, { embed: buildFakeEmbedder(), await: true });

    const { createApp } = await import('../app.js');
    const request = (await import('supertest')).default;
    const app = createApp(db);
    const res = await request(app).get('/api/topics/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.documentCount).toBe(DOCS.length);
    expect(res.body.modelVersion).toBe(TOPIC_MODEL_VERSION);
  });

  it('shouldRecompute fires when document count drifts by 10%', () => {
    expect(
      shouldRecompute(100, { documentCount: 100, computedAt: null, modelVersion: TOPIC_MODEL_VERSION }),
    ).toBe(false);
    expect(
      shouldRecompute(115, { documentCount: 100, computedAt: null, modelVersion: TOPIC_MODEL_VERSION }),
    ).toBe(true);
    expect(
      shouldRecompute(105, { documentCount: 100, computedAt: null, modelVersion: TOPIC_MODEL_VERSION }),
    ).toBe(false);
    // Stored model version mismatch forces a recompute.
    expect(
      shouldRecompute(100, { documentCount: 100, computedAt: null, modelVersion: 'old-version' }),
    ).toBe(true);
  });
});
