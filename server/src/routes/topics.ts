import { Router } from 'express';
import type { Database as DatabaseT } from 'better-sqlite3';

import type {
  Topic,
  TopicDriftPoint,
  TopicDetailResponse,
  TopicDriftResponse,
  TopicMember,
  TopicsResponse,
} from '@tr/shared';

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

export function createTopicsRouter(db: DatabaseT): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = db
      .prepare('SELECT id, label, keywords, size, computed_at, model_version FROM topics ORDER BY size DESC, id ASC')
      .all() as TopicRow[];
    const payload: TopicsResponse = {
      items: rows.map(rowToTopic),
      total: rows.length,
    };
    return res.json(payload);
  });

  router.get('/drift', (req, res) => {
    const bin = typeof req.query.bin === 'string' ? req.query.bin : 'year';
    if (bin !== 'year') {
      return res.status(400).json({
        error: `Unsupported bin: ${bin}. Only 'year' is supported in this release.`,
      });
    }
    const rows = db
      .prepare('SELECT topic_id, period, document_count, share FROM topic_drift ORDER BY period ASC, topic_id ASC')
      .all() as TopicDriftRow[];
    const points: TopicDriftPoint[] = rows.map((r) => ({
      topicId: r.topic_id,
      period: r.period,
      documentCount: r.document_count,
      share: r.share,
    }));
    const payload: TopicDriftResponse = { points };
    return res.json(payload);
  });

  router.get('/:id', (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 0) {
      return res.status(400).json({ error: `Invalid topic id: ${req.params.id}` });
    }
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : DEFAULT_LIMIT;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

    const row = db
      .prepare('SELECT id, label, keywords, size, computed_at, model_version FROM topics WHERE id = ?')
      .get(id) as TopicRow | undefined;
    if (!row) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const memberRows = db
      .prepare(
        `SELECT dt.document_id AS document_id,
                dt.probability  AS probability,
                d.title         AS title,
                d.date          AS date
           FROM document_topics dt
           JOIN documents d ON d.id = dt.document_id
          WHERE dt.topic_id = ?
          ORDER BY dt.probability DESC, dt.document_id ASC
          LIMIT ?`,
      )
      .all(id, limit) as TopicMemberRow[];

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
