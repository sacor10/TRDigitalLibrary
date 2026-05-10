import { Router } from 'express';

import type {
  DocumentSentiment,
  SentimentBin,
  SentimentExtremeItem,
  SentimentExtremesResponse,
  SentimentLabel,
  SentimentTimelinePoint,
  SentimentTimelineResponse,
} from '@tr/shared';

import type { LibsqlClient } from '../db.js';

interface SentimentRow {
  document_id: string;
  polarity: number;
  pos: number;
  neu: number;
  neg: number;
  label: string;
  sentence_count: number;
  computed_at: string;
  model_version: string;
}

interface TimelineRow {
  period: string;
  mean_polarity: number;
  document_count: number;
}

interface ExtremeRow {
  document_id: string;
  title: string;
  date: string;
  polarity: number;
  label: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

function rowToSentiment(row: SentimentRow): DocumentSentiment {
  return {
    documentId: row.document_id,
    polarity: row.polarity,
    pos: row.pos,
    neu: row.neu,
    neg: row.neg,
    label: row.label as SentimentLabel,
    sentenceCount: row.sentence_count,
    computedAt: row.computed_at,
    modelVersion: row.model_version,
  };
}

export function createSentimentRouter(db: LibsqlClient): Router {
  const router = Router();

  router.get('/timeline', async (req, res) => {
    const binRaw = typeof req.query.bin === 'string' ? req.query.bin : 'month';
    if (binRaw !== 'month' && binRaw !== 'year') {
      return res.status(400).json({
        error: `Unsupported bin: ${binRaw}. Use 'month' or 'year'.`,
      });
    }
    const bin: SentimentBin = binRaw;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (from && !ISO_DATE.test(from)) {
      return res.status(400).json({ error: `Invalid 'from' date: ${from}. Expected YYYY-MM-DD.` });
    }
    if (to && !ISO_DATE.test(to)) {
      return res.status(400).json({ error: `Invalid 'to' date: ${to}. Expected YYYY-MM-DD.` });
    }

    // SQLite has no native date_trunc; substr is exact for ISO 8601 dates.
    const periodExpr = bin === 'year' ? 'substr(d.date, 1, 4)' : 'substr(d.date, 1, 7)';
    const params: (string | number)[] = [];
    const where: string[] = [];
    if (from) {
      where.push('d.date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('d.date <= ?');
      params.push(to);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `
      SELECT ${periodExpr}            AS period,
             AVG(s.polarity)          AS mean_polarity,
             COUNT(*)                 AS document_count
        FROM document_sentiment s
        JOIN documents d ON d.id = s.document_id
        ${whereSql}
       GROUP BY period
       ORDER BY period ASC
    `;
    const result = await db.execute({ sql, args: params });
    const rows: TimelineRow[] = result.rows.map((r) => ({
      period: asString(r.period),
      mean_polarity: asNumber(r.mean_polarity),
      document_count: asNumber(r.document_count),
    }));
    const points: SentimentTimelinePoint[] = rows.map((r) => ({
      period: r.period,
      meanPolarity: r.mean_polarity,
      documentCount: r.document_count,
    }));
    const payload: SentimentTimelineResponse = { bin, from, to, points };
    return res.json(payload);
  });

  router.get('/extremes', async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (from && !ISO_DATE.test(from)) {
      return res.status(400).json({ error: `Invalid 'from' date: ${from}. Expected YYYY-MM-DD.` });
    }
    if (to && !ISO_DATE.test(to)) {
      return res.status(400).json({ error: `Invalid 'to' date: ${to}. Expected YYYY-MM-DD.` });
    }
    const limitRaw =
      typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : DEFAULT_LIMIT;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

    const params: (string | number)[] = [];
    const where: string[] = [];
    if (from) {
      where.push('d.date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('d.date <= ?');
      params.push(to);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const select = `
      SELECT s.document_id AS document_id,
             d.title       AS title,
             d.date        AS date,
             s.polarity    AS polarity,
             s.label       AS label
        FROM document_sentiment s
        JOIN documents d ON d.id = s.document_id
        ${whereSql}
    `;
    const positiveResult = await db.execute({
      sql: `${select} ORDER BY s.polarity DESC, s.document_id ASC LIMIT ?`,
      args: [...params, limit],
    });
    const negativeResult = await db.execute({
      sql: `${select} ORDER BY s.polarity ASC, s.document_id ASC LIMIT ?`,
      args: [...params, limit],
    });

    const toRow = (r: import('@libsql/client').Row): ExtremeRow => ({
      document_id: asString(r.document_id),
      title: asString(r.title),
      date: asString(r.date),
      polarity: asNumber(r.polarity),
      label: asString(r.label),
    });
    const positiveRows = positiveResult.rows.map(toRow);
    const negativeRows = negativeResult.rows.map(toRow);

    const toItem = (r: ExtremeRow): SentimentExtremeItem => ({
      documentId: r.document_id,
      title: r.title,
      date: r.date,
      polarity: r.polarity,
      label: r.label as SentimentLabel,
    });
    const payload: SentimentExtremesResponse = {
      from,
      to,
      mostPositive: positiveRows.map(toItem),
      mostNegative: negativeRows.map(toItem),
    };
    return res.json(payload);
  });

  router.get('/documents/:id', async (req, res) => {
    const result = await db.execute({
      sql: `SELECT document_id, polarity, pos, neu, neg, label,
                   sentence_count, computed_at, model_version
              FROM document_sentiment
             WHERE document_id = ?`,
      args: [req.params.id],
    });
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No sentiment record for this document.' });
    }
    const r = result.rows[0]!;
    const row: SentimentRow = {
      document_id: asString(r.document_id),
      polarity: asNumber(r.polarity),
      pos: asNumber(r.pos),
      neu: asNumber(r.neu),
      neg: asNumber(r.neg),
      label: asString(r.label),
      sentence_count: asNumber(r.sentence_count),
      computed_at: asString(r.computed_at),
      model_version: asString(r.model_version),
    };
    return res.json(rowToSentiment(row));
  });

  return router;
}
