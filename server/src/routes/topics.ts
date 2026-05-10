import { Router } from 'express';

import type {
  Topic,
  TopicDriftPoint,
  TopicDetailResponse,
  TopicDriftResponse,
  TopicMember,
  TopicsResponse,
} from '@tr/shared';

import type { LibsqlClient } from '../db.js';

interface TopicRow {
  id: number;
  label: string;
  keywords: string;
  size: number;
  computed_at: string;
  model_version: string;
}

interface TopicMemberRow {
  document_id: string;
  probability: number;
  title: string;
  date: string;
}

interface TopicDriftRow {
  topic_id: number;
  period: string;
  document_count: number;
  share: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

function rowToTopic(row: TopicRow): Topic {
  let keywords: string[] = [];
  try {
    const parsed = JSON.parse(row.keywords) as unknown;
    if (Array.isArray(parsed)) {
      keywords = parsed.filter((k): k is string => typeof k === 'string');
    }
  } catch {
    keywords = [];
  }
  return {
    id: row.id,
    label: row.label,
    keywords,
    size: row.size,
    computedAt: row.computed_at,
    modelVersion: row.model_version,
  };
}

export function createTopicsRouter(db: LibsqlClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const result = await db.execute(
      'SELECT id, label, keywords, size, computed_at, model_version FROM topics ORDER BY size DESC, id ASC',
    );
    const rows: TopicRow[] = result.rows.map((row) => ({
      id: asNumber(row.id),
      label: asString(row.label),
      keywords: asString(row.keywords),
      size: asNumber(row.size),
      computed_at: asString(row.computed_at),
      model_version: asString(row.model_version),
    }));
    const payload: TopicsResponse = {
      items: rows.map(rowToTopic),
      total: rows.length,
    };
    return res.json(payload);
  });

  router.get('/drift', async (req, res) => {
    const bin = typeof req.query.bin === 'string' ? req.query.bin : 'year';
    if (bin !== 'year') {
      return res.status(400).json({
        error: `Unsupported bin: ${bin}. Only 'year' is supported in this release.`,
      });
    }
    const result = await db.execute(
      'SELECT topic_id, period, document_count, share FROM topic_drift ORDER BY period ASC, topic_id ASC',
    );
    const rows: TopicDriftRow[] = result.rows.map((row) => ({
      topic_id: asNumber(row.topic_id),
      period: asString(row.period),
      document_count: asNumber(row.document_count),
      share: asNumber(row.share),
    }));
    const totalShareByPeriod = new Map<string, number>();
    for (const row of rows) {
      totalShareByPeriod.set(row.period, (totalShareByPeriod.get(row.period) ?? 0) + row.share);
    }
    const points: TopicDriftPoint[] = rows.map((r) => ({
      topicId: r.topic_id,
      period: r.period,
      documentCount: r.document_count,
      share:
        (totalShareByPeriod.get(r.period) ?? 0) > 1
          ? r.share / (totalShareByPeriod.get(r.period) ?? 1)
          : r.share,
    }));
    const payload: TopicDriftResponse = { points };
    return res.json(payload);
  });

  router.get('/:id', async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 0) {
      return res.status(400).json({ error: `Invalid topic id: ${req.params.id}` });
    }
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : DEFAULT_LIMIT;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

    const topicResult = await db.execute({
      sql: 'SELECT id, label, keywords, size, computed_at, model_version FROM topics WHERE id = ?',
      args: [id],
    });
    if (topicResult.rows.length === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }
    const tRow = topicResult.rows[0]!;
    const row: TopicRow = {
      id: asNumber(tRow.id),
      label: asString(tRow.label),
      keywords: asString(tRow.keywords),
      size: asNumber(tRow.size),
      computed_at: asString(tRow.computed_at),
      model_version: asString(tRow.model_version),
    };

    const memberResult = await db.execute({
      sql: `SELECT dt.document_id AS document_id,
                   dt.probability  AS probability,
                   d.title         AS title,
                   d.date          AS date
              FROM document_topics dt
              JOIN documents d ON d.id = dt.document_id
             WHERE dt.topic_id = ?
             ORDER BY dt.probability DESC, dt.document_id ASC
             LIMIT ?`,
      args: [id, limit],
    });
    const memberRows: TopicMemberRow[] = memberResult.rows.map((m) => ({
      document_id: asString(m.document_id),
      probability: asNumber(m.probability),
      title: asString(m.title),
      date: asString(m.date),
    }));

    const members: TopicMember[] = memberRows.map((m) => ({
      documentId: m.document_id,
      probability: m.probability,
      title: m.title,
      date: m.date,
    }));

    const payload: TopicDetailResponse = {
      topic: rowToTopic(row),
      members,
    };
    return res.json(payload);
  });

  return router;
}
