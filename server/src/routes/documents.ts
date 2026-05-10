import { Router } from 'express';
import type { InValue } from '@libsql/client';

import { DocumentListQuerySchema, DocumentPatchSchema } from '@tr/shared';

import {
  getSectionsByDocumentId,
  patchDocumentFields,
  rowToDocument,
  rowToDocumentRow,
  rowToDocumentWithProvenance,
  type LibsqlClient,
  type ProvenanceContext,
} from '../db.js';
import { FORMAT_BY_EXT, generateExport } from '../export/index.js';

export interface CreateDocumentsRouterOptions {
  readonly?: boolean | undefined;
}

function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

export function createDocumentsRouter(
  db: LibsqlClient,
  opts: CreateDocumentsRouterOptions = {},
): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const parsed = DocumentListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { type, dateFrom, dateTo, recipient, sort, order, limit, offset } = parsed.data;

    const where: string[] = [];
    const params: Record<string, InValue> = {};
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

    try {
      const totalResult = await db.execute({
        sql: `SELECT COUNT(*) as c FROM documents ${whereSql}`,
        args: params,
      });
      const total = asNumber(totalResult.rows[0]?.c);

      const listResult = await db.execute({
        sql: `SELECT * FROM documents ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`,
        args: { ...params, limit, offset },
      });
      const rows = listResult.rows.map(rowToDocumentRow);

      const items = await Promise.all(rows.map((row) => rowToDocumentWithProvenance(db, row)));

      return res.json({ items, total });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[documents] list failed', err);
      return res.status(500).json({ error: 'Failed to list documents', details: message });
    }
  });

  router.get('/:id/export.:ext', async (req, res) => {
    const { id, ext } = req.params;
    const format = FORMAT_BY_EXT[ext];
    if (!format) {
      return res.status(404).json({ error: `Unsupported export extension: ${ext}` });
    }
    try {
      const result = await db.execute({
        sql: 'SELECT * FROM documents WHERE id = ?',
        args: [id],
      });
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }
      const docRow = rowToDocumentRow(result.rows[0]!);
      const doc = rowToDocument(docRow);
      const sections = await getSectionsByDocumentId(db, id);
      const artifact = await generateExport(doc, sections, format);
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${artifact.filename}"`,
      );
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).send(artifact.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      console.error('[documents] export failed', err);
      return res.status(500).json({ error: 'Export failed', details: message });
    }
  });

  router.get('/:id', async (req, res) => {
    const id = req.params.id;
    try {
      const result = await db.execute({
        sql: 'SELECT * FROM documents WHERE id = ?',
        args: [id],
      });
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }
      const docRow = rowToDocumentRow(result.rows[0]!);
      return res.json(await rowToDocumentWithProvenance(db, docRow));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[documents] fetch failed', err);
      return res.status(500).json({ error: 'Failed to fetch document', details: message });
    }
  });

  if (!opts.readonly) {
    router.patch('/:id', async (req, res) => {
      const editorHeader = req.header('x-editor');
      const editor = typeof editorHeader === 'string' ? editorHeader.trim() : '';
      if (!editor) {
        return res.status(400).json({
          error: 'Missing X-Editor header',
          details: 'Corrections require an X-Editor header identifying the editor.',
        });
      }

      const parsed = DocumentPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      }

      const ctx: ProvenanceContext = {
        sourceUrl: null,
        fetchedAt: new Date().toISOString(),
        editor,
      };

      try {
        const updated = await patchDocumentFields(db, req.params.id, parsed.data, ctx);
        if (!updated) {
          return res.status(404).json({ error: 'Document not found' });
        }
        return res.json(updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[documents] patch failed', err);
        return res.status(500).json({ error: 'Failed to update document', details: message });
      }
    });
  }

  return router;
}
