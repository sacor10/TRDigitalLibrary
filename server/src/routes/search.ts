import { SearchQuerySchema } from '@tr/shared';
import { Router } from 'express';


import { rowToDocument, rowToDocumentRow, type LibsqlClient } from '../db.js';

function buildFtsQuery(raw: string): string {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"`);
  if (tokens.length === 0) {
    return '""';
  }
  return tokens.join(' AND ');
}

function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

export function createSearchRouter(db: LibsqlClient): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const parsed = SearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { q, type, dateFrom, dateTo, recipient, limit } = parsed.data;
    const ftsQuery = buildFtsQuery(q);

    const where: string[] = ['documents_fts MATCH @ftsQuery'];
    const params: Record<string, string | number> = { ftsQuery, limit };
    if (type) {
      where.push('documents.type = @type');
      params.type = type;
    }
    if (dateFrom) {
      where.push('documents.date >= @dateFrom');
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      where.push('documents.date <= @dateTo');
      params.dateTo = dateTo;
    }
    if (recipient) {
      where.push('documents.recipient LIKE @recipient');
      params.recipient = `%${recipient}%`;
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const sql = `
      SELECT
        documents.*,
        snippet(documents_fts, -1, '<mark>', '</mark>', '…', 16) AS snippet,
        bm25(documents_fts) AS rank
      FROM documents_fts
      JOIN documents ON documents.rowid = documents_fts.rowid
      ${whereSql}
      ORDER BY rank
      LIMIT @limit
    `;

    try {
      const result = await db.execute({ sql, args: params });
      const countResult = await db.execute({
        sql: `SELECT COUNT(*) as c
              FROM documents_fts
              JOIN documents ON documents.rowid = documents_fts.rowid
              ${whereSql}`,
        args: params,
      });
      const total = asNumber(countResult.rows[0]?.c);

      return res.json({
        results: result.rows.map((row) => ({
          document: rowToDocument(rowToDocumentRow(row)),
          snippet: asString(row.snippet),
        })),
        total,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: 'Invalid search', details: message });
    }
  });

  return router;
}
