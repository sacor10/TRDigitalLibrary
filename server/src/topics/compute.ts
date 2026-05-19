import type { InStatement } from '@libsql/client';


import type { LibsqlClient } from '../db.js';

import { selectAndCluster } from './cluster.js';
import { embedTexts, type EmbedFn } from './embed.js';
import { shortLabel, topKeywordsPerCluster } from './keywords.js';

// Bump this string when the algorithm changes in a way that should force a
// recompute on the next boot, even if the document count is unchanged.
export const TOPIC_MODEL_VERSION = 'ts-bootstrap:Xenova/all-MiniLM-L6-v2:kmeans-v1';

export type ComputeStage =
  | 'loading'
  | 'embedding'
  | 'clustering'
  | 'keywords'
  | 'persisting';

export type ComputeProgress = (stage: ComputeStage) => void;

interface DocRow {
  id: string;
  date: string;
  transcription: string;
}

async function loadCorpus(db: LibsqlClient): Promise<DocRow[]> {
  const result = await db.execute(
    "SELECT id, date, transcription FROM documents WHERE length(trim(transcription)) > 0 ORDER BY date ASC",
  );
  return result.rows.map((r) => ({
    id: String(r.id ?? ''),
    date: String(r.date ?? ''),
    transcription: String(r.transcription ?? ''),
  }));
}

function yearOf(iso: string): string | null {
  if (!iso || iso.length < 4) return null;
  const y = iso.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : null;
}

export interface ComputeOptions {
  onProgress?: ComputeProgress;
  embed?: EmbedFn;
}

export interface ComputeResult {
  documentCount: number;
  topicCount: number;
  computedAt: string;
}

export async function computeTopics(
  db: LibsqlClient,
  opts: ComputeOptions = {},
): Promise<ComputeResult | null> {
  opts.onProgress?.('loading');
  const docs = await loadCorpus(db);
  if (docs.length === 0) return null;

  opts.onProgress?.('embedding');
  const embed = opts.embed ?? embedTexts;
  const vectors = await embed(docs.map((d) => d.transcription));
  if (vectors.length !== docs.length) {
    throw new Error(
      `embedTexts returned ${vectors.length} vectors for ${docs.length} documents`,
    );
  }

  opts.onProgress?.('clustering');
  // Defaults inside selectAndCluster scale k with corpus size; pass no
  // explicit bounds so a small dev DB and the user's 500-doc corpus both
  // get reasonable clusterings.
  const { assignments } = selectAndCluster(vectors);
  if (assignments.length === 0) return null;
  const distinct = new Set(assignments);
  const totalClusters = Math.max(...distinct) + 1;

  opts.onProgress?.('keywords');
  const keywordsByOld = topKeywordsPerCluster({
    texts: docs.map((d) => d.transcription),
    assignments,
    k: totalClusters,
  });

  // Re-id 0..N-1 by descending member count for stable PKs (mirrors Python).
  const counts = new Map<number, number>();
  for (const a of assignments) counts.set(a, (counts.get(a) ?? 0) + 1);
  const sortedOld = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0],
  );
  const remap = new Map<number, number>();
  sortedOld.forEach(([oldId], i) => remap.set(oldId, i));

  const computedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const stmts: InStatement[] = [
    'DELETE FROM topic_drift',
    'DELETE FROM document_topics',
    'DELETE FROM topics',
  ];

  for (const [oldId, newId] of remap) {
    const kws = keywordsByOld.get(oldId) ?? [];
    stmts.push({
      sql: 'INSERT INTO topics (id, label, keywords, size, computed_at, model_version) VALUES (?, ?, ?, ?, ?, ?)',
      args: [
        newId,
        shortLabel(kws),
        JSON.stringify(kws),
        counts.get(oldId) ?? 0,
        computedAt,
        TOPIC_MODEL_VERSION,
      ],
    });
  }

  const driftCount = new Map<string, number>();
  const driftPeriodTotal = new Map<string, number>();
  for (let i = 0; i < docs.length; i++) {
    const newId = remap.get(assignments[i]!);
    if (newId === undefined) continue;
    stmts.push({
      sql: 'INSERT INTO document_topics (document_id, topic_id, probability) VALUES (?, ?, ?)',
      args: [docs[i]!.id, newId, 1.0],
    });
    const period = yearOf(docs[i]!.date);
    if (period !== null) {
      const key = `${newId}|${period}`;
      driftCount.set(key, (driftCount.get(key) ?? 0) + 1);
      driftPeriodTotal.set(period, (driftPeriodTotal.get(period) ?? 0) + 1);
    }
  }
  for (const [key, count] of driftCount) {
    const [tidStr, period] = key.split('|');
    const tid = Number(tidStr);
    const total = driftPeriodTotal.get(period!) ?? 1;
    stmts.push({
      sql: 'INSERT INTO topic_drift (topic_id, period, document_count, share) VALUES (?, ?, ?, ?)',
      args: [tid, period!, count, count / total],
    });
  }

  // Singleton upsert -- one row tracking the inputs to this run.
  stmts.push({
    sql: `INSERT INTO topic_compute_meta (id, document_count, computed_at, model_version)
          VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            document_count = excluded.document_count,
            computed_at    = excluded.computed_at,
            model_version  = excluded.model_version`,
    args: [docs.length, computedAt, TOPIC_MODEL_VERSION],
  });

  opts.onProgress?.('persisting');
  await db.batch(stmts, 'write');

  return {
    documentCount: docs.length,
    topicCount: remap.size,
    computedAt,
  };
}
