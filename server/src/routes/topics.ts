import type {
  Topic,
  TopicDriftPoint,
  TopicDetailResponse,
  TopicDriftResponse,
  TopicMember,
  TopicsResponse,
} from '@tr/shared';
import { Router } from 'express';

import type { LibsqlClient } from '../db.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

export function createTopicsRouter(db: LibsqlClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const result = await db.execute(
      `SELECT je.value AS tag, COUNT(*) AS size
         FROM documents d, json_each(d.tags) je
        GROUP BY je.value
        ORDER BY size DESC, tag ASC`,
    );
    const items: Topic[] = result.rows.map((row) => {
      const tag = asString(row.tag);
      return { id: tag, label: tag, size: asNumber(row.size) };
    });
    const payload: TopicsResponse = { items, total: items.length };
    return res.json(payload);
  });

  router.get('/drift', async (req, res) => {
    const bin = typeof req.query.bin === 'string' ? req.query.bin : 'year';
    if (bin !== 'year') {
      return res.status(400).json({
        error: `Unsupported bin: ${bin}. Only 'year' is supported in this release.`,
      });
    }

    // Tagged docs per (tag, year).
    const perTagResult = await db.execute(
      `SELECT je.value AS tag,
              substr(d.date, 1, 4) AS period,
              COUNT(*) AS document_count
         FROM documents d, json_each(d.tags) je
        WHERE d.date <> ''
        GROUP BY tag, period
        ORDER BY period ASC, tag ASC`,
    );

    // Total tagged documents per year (denominator for share). A doc with N
    // tags counts N times — keeps shares comparable to the per-tag count and
    // ensures shares sum to 1.0 per period.
    const totalsResult = await db.execute(
      `SELECT substr(d.date, 1, 4) AS period,
              COUNT(*) AS total
         FROM documents d, json_each(d.tags) je
        WHERE d.date <> ''
        GROUP BY period`,
    );
    const totalsByPeriod = new Map<string, number>();
    for (const row of totalsResult.rows) {
      totalsByPeriod.set(asString(row.period), asNumber(row.total));
    }

    const points: TopicDriftPoint[] = perTagResult.rows.map((row) => {
      const period = asString(row.period);
      const documentCount = asNumber(row.document_count);
      const total = totalsByPeriod.get(period) ?? 0;
      return {
        topicId: asString(row.tag),
        period,
        documentCount,
        share: total > 0 ? documentCount / total : 0,
      };
    });
    const payload: TopicDriftResponse = { points };
    return res.json(payload);
  });

  router.get('/:id', async (req, res) => {
    const tag = decodeURIComponent(req.params.id);
    if (!tag) {
      return res.status(400).json({ error: `Invalid tag: ${req.params.id}` });
    }
    const limitRaw =
      typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : DEFAULT_LIMIT;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;
    const offsetRaw =
      typeof req.query.offset === 'string' ? Number.parseInt(req.query.offset, 10) : 0;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    const sizeResult = await db.execute({
      sql: `SELECT COUNT(*) AS size
              FROM documents d
             WHERE EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value = ?)`,
      args: [tag],
    });
    const size = asNumber(sizeResult.rows[0]?.size);
    if (size === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const memberResult = await db.execute({
      sql: `SELECT id AS document_id, title, date
             FROM documents d
             WHERE EXISTS (SELECT 1 FROM json_each(d.tags) WHERE value = ?)
             ORDER BY date DESC, id ASC
             LIMIT ? OFFSET ?`,
      args: [tag, limit, offset],
    });
    const members: TopicMember[] = memberResult.rows.map((m) => ({
      documentId: asString(m.document_id),
      title: asString(m.title),
      date: asString(m.date),
    }));

    const payload: TopicDetailResponse = {
      topic: { id: tag, label: tag, size },
      members,
      total: size,
      limit,
      offset,
    };
    return res.json(payload);
  });

  return router;
}
