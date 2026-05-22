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
const GLOBAL_TOPIC_THRESHOLD = 0.95;

const TAGGED_DOCUMENTS_CTE = `
  tagged_documents AS (
    SELECT COUNT(DISTINCT document_id) AS total
      FROM document_topic_assignments
  )
`;

const TAG_COUNTS_CTE = `
  tag_counts AS (
    SELECT topic AS tag,
           COUNT(*) AS size
      FROM document_topic_assignments
     GROUP BY topic
  )
`;

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

export function createTopicsRouter(db: LibsqlClient): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const result = await db.execute({
      sql: `WITH ${TAGGED_DOCUMENTS_CTE},
                 ${TAG_COUNTS_CTE}
       SELECT tag, size
         FROM tag_counts, tagged_documents
        WHERE size < tagged_documents.total * ?
        ORDER BY size DESC, tag ASC`,
      args: [GLOBAL_TOPIC_THRESHOLD],
    });
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

    const perTagResult = await db.execute({
      sql: `WITH ${TAGGED_DOCUMENTS_CTE},
                 ${TAG_COUNTS_CTE},
                 visible_topics AS (
                   SELECT tag
                     FROM tag_counts, tagged_documents
                    WHERE size < tagged_documents.total * ?
                 )
       SELECT dta.topic AS tag,
              dta.period AS period,
              COUNT(*) AS document_count
         FROM document_topic_assignments dta
         JOIN visible_topics vt ON vt.tag = dta.topic
        WHERE dta.period <> ''
        GROUP BY dta.topic, dta.period
        ORDER BY dta.period ASC, dta.topic ASC`,
      args: [GLOBAL_TOPIC_THRESHOLD],
    });

    // Denominator for share: count each tagged document once per year, even
    // when it has multiple topics.
    const totalsResult = await db.execute(
      `SELECT period,
              COUNT(DISTINCT document_id) AS total
         FROM document_topic_assignments
        WHERE period <> ''
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
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;
    const offsetRaw =
      typeof req.query.offset === 'string' ? Number.parseInt(req.query.offset, 10) : 0;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    const topicResult = await db.execute({
      sql: `WITH ${TAGGED_DOCUMENTS_CTE},
                 ${TAG_COUNTS_CTE}
       SELECT size
         FROM tag_counts, tagged_documents
        WHERE tag = ?
          AND size < tagged_documents.total * ?`,
      args: [tag, GLOBAL_TOPIC_THRESHOLD],
    });
    const size = asNumber(topicResult.rows[0]?.size);
    if (size === 0) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const memberResult = await db.execute({
      sql: `SELECT id AS document_id, title, date
             FROM documents d
             JOIN document_topic_assignments dta ON dta.document_id = d.id
            WHERE dta.topic = ?
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
