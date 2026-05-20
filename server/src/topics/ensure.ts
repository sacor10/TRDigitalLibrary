import type { LibsqlClient } from '../db.js';

import { type ComputeOptions, type ComputeStage, computeTopics } from './compute.js';
import {
  TOPIC_MODEL_VERSION,
  getComputeStatus,
  setComputeStatus,
  _resetComputeStatusForTests as resetStatusSingleton,
} from './status.js';

// Recompute when the document count drifts by at least this fraction from
// the last recorded run. Picked to be tolerant of small ingest tweaks but
// sensitive enough that adding a meaningful batch of letters forces a fresh
// clustering pass.
const RECOMPUTE_RATIO = 0.1;

// Re-exported so existing tests (and any other call sites) keep working
// after the singleton was moved into `./status.js`.
export { getComputeStatus };
export type { TopicComputeStatus, TopicComputeStatusValue } from './status.js';

// Approximate share of total wall time each stage takes on a 500-doc corpus.
// Used to advance the progress bar so the user has feedback during the slow
// first-boot model download + encode phase.
const STAGE_WEIGHTS: Record<ComputeStage, number> = {
  loading: 0.02,
  embedding: 0.6,
  clustering: 0.2,
  keywords: 0.1,
  persisting: 0.08,
};
const STAGES: ComputeStage[] = [
  'loading',
  'embedding',
  'clustering',
  'keywords',
  'persisting',
];

let inFlight: Promise<void> | null = null;

/** @internal Test-only reset for both the status singleton and the in-flight latch. */
export function _resetComputeStatusForTests(): void {
  resetStatusSingleton();
  inFlight = null;
}

interface MetaRow {
  documentCount: number;
  computedAt: string | null;
  modelVersion: string | null;
}

async function readMeta(db: LibsqlClient): Promise<MetaRow> {
  const result = await db.execute(
    'SELECT document_count, computed_at, model_version FROM topic_compute_meta WHERE id = 1',
  );
  if (result.rows.length === 0) {
    return { documentCount: 0, computedAt: null, modelVersion: null };
  }
  const r = result.rows[0]!;
  return {
    documentCount: Number(r.document_count ?? 0),
    computedAt: r.computed_at == null ? null : String(r.computed_at),
    modelVersion: r.model_version == null ? null : String(r.model_version),
  };
}

async function countDocs(db: LibsqlClient): Promise<number> {
  const result = await db.execute(
    "SELECT COUNT(*) AS c FROM documents WHERE length(trim(transcription)) > 0",
  );
  const row = result.rows[0];
  if (!row) return 0;
  const v = row.c;
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

async function countTopics(db: LibsqlClient): Promise<number> {
  const result = await db.execute('SELECT COUNT(*) AS c FROM topics');
  const row = result.rows[0];
  if (!row) return 0;
  const v = row.c;
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

export function shouldRecompute(currentDocs: number, meta: MetaRow): boolean {
  if (meta.modelVersion !== TOPIC_MODEL_VERSION) return true;
  if (meta.documentCount === 0) return currentDocs > 0;
  const delta = Math.abs(currentDocs - meta.documentCount) / meta.documentCount;
  return delta >= RECOMPUTE_RATIO;
}

export interface EnsureOptions {
  embed?: ComputeOptions['embed'];
  // When true, await the compute pass inline. Default is fire-and-forget so
  // the HTTP listener doesn't wait on a ~minute-long embed pass on first boot.
  await?: boolean;
}

export async function ensureTopicsComputed(
  db: LibsqlClient,
  opts: EnsureOptions = {},
): Promise<void> {
  if (inFlight) return opts.await ? inFlight : undefined;

  const docs = await countDocs(db);
  const meta = await readMeta(db);
  const topicsRows = await countTopics(db);

  if (docs === 0) {
    setComputeStatus({
      status: 'idle',
      progress: 0,
      documentCount: 0,
      computedAt: meta.computedAt,
      modelVersion: meta.modelVersion ?? TOPIC_MODEL_VERSION,
      error: null,
    });
    return;
  }

  const recompute = topicsRows === 0 || shouldRecompute(docs, meta);
  if (!recompute) {
    setComputeStatus({
      status: 'ready',
      progress: 1,
      documentCount: meta.documentCount,
      computedAt: meta.computedAt,
      modelVersion: meta.modelVersion ?? TOPIC_MODEL_VERSION,
      error: null,
    });
    return;
  }

  setComputeStatus({
    status: 'computing',
    progress: 0,
    documentCount: docs,
    computedAt: meta.computedAt,
    modelVersion: TOPIC_MODEL_VERSION,
    error: null,
  });

  inFlight = (async () => {
    try {
      const compOpts: ComputeOptions = {
        onProgress: (stage) => {
          const idx = STAGES.indexOf(stage);
          const progress = STAGES.slice(0, idx).reduce(
            (s, k) => s + STAGE_WEIGHTS[k],
            0,
          );
          setComputeStatus({ ...getComputeStatus(), progress });
        },
      };
      if (opts.embed) compOpts.embed = opts.embed;
      const result = await computeTopics(db, compOpts);
      if (!result) {
        setComputeStatus({ ...getComputeStatus(), status: 'idle', progress: 0 });
        return;
      }
      setComputeStatus({
        status: 'ready',
        progress: 1,
        documentCount: result.documentCount,
        computedAt: result.computedAt,
        modelVersion: TOPIC_MODEL_VERSION,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[topics] auto-compute failed:', message);
      setComputeStatus({ ...getComputeStatus(), status: 'error', error: message });
    } finally {
      inFlight = null;
    }
  })();
  if (opts.await) await inFlight;
}
