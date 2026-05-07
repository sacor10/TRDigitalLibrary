import { Router } from 'express';
import type { Database as DatabaseT } from 'better-sqlite3';

import { DocumentListQuerySchema } from '@tr/shared';

import { rowToDocument, type DocumentRow } from '../db.js';

export function createDocumentsRouter(db: DatabaseT): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const parsed = DocumentListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { type, dateFrom, dateTo, recipient, sort, order, limit, offset } = parsed.data;

    const where: string[] = [];
    const params: Record<string, string | number> = {};
    if (type) {
      where.push('type = @type');
      params.type = type;
    }
    if (dateFrom) {
      where.push('date >= @dateFrom');
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      where.push('date <= @dateTo');
      params.dateTo = dateTo;
    }
    if (recipient) {
      where.push('recipient LIKE @recipient');
      params.recipient = `%${recipient}%`;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = `ORDER BY ${sort} ${order.toUpperCase()}`;

    const totalRow = db
      .prepare(`SELECT COUNT(*) as c FROM documents ${whereSql}`)
      .get(params) as { c: number };

    const rows = db
      .prepare(
        `SELECT * FROM documents ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as DocumentRow[];

    return res.json({
      items: rows.map(rowToDocument),
      total: totalRow.c,
    });
  });

  router.get('/:id', (req, res) => {
    const id = req.params.id;
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
      | DocumentRow
      | undefined;
    if (!row) {
      return res.status(404).json({ error: 'Document not found' });
    }
    return res.json(rowToDocument(row));
  });

  return router;
}
