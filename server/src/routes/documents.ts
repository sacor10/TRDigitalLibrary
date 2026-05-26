import type { InValue } from '@libsql/client';
import { DocumentListQuerySchema, DocumentPatchSchema, DocumentTypeSchema } from '@tr/shared';
import { Router } from 'express';

import {
  getFieldProvenanceForDocuments,
  getSectionsByDocumentId,
  patchDocumentFields,
  rowToDocument,
  rowToDocumentRow,
  rowToDocumentWithProvenance,
  type LibsqlClient,
  type ProvenanceContext,
} from '../db.js';
import { FORMAT_BY_EXT, generateExport } from '../export/index.js';
import { setPublicCache } from '../http-cache.js';

import {
  DOCUMENT_DETAIL_COLUMNS,
  DOCUMENT_SUMMARY_COLUMNS,
  asNumber,
  getDocumentFacets,
} from './document-query.js';

export interface CreateDocumentsRouterOptions {
  readonly?: boolean | undefined;
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
    const { type, dateFrom, dateTo, recipient, tag, sort, order, limit, offset } = parsed.data;

    const where: string[] = [];
    const typeFacetWhere: string[] = [];
    const tagFacetWhere: string[] = [];
    const params: Record<string, InValue> = {};
    const addFilter = (sql: string, except: 'type' | 'tag' | null = null): void => {
      where.push(sql);
      if (except !== 'type') typeFacetWhere.push(sql);
      if (except !== 'tag') tagFacetWhere.push(sql);
    };
    if (type) {
      addFilter('documents.type = @type', 'type');
      params.type = type;
    }
    if (dateFrom) {
      addFilter('documents.date >= @dateFrom');
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      addFilter('documents.date <= @dateTo');
      params.dateTo = dateTo;
    }
    if (recipient) {
      addFilter('documents.recipient LIKE @recipient');
      params.recipient = `%${recipient}%`;
    }
    if (tag !== undefined) {
      addFilter(
        'EXISTS (SELECT 1 FROM document_topic_assignments dta_filter WHERE dta_filter.document_id = documents.id AND dta_filter.topic = @tag)',
        'tag',
      );
      params.tag = tag;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = `ORDER BY documents.${sort} ${order.toUpperCase()}`;

    try {
      const totalResult = await db.execute({
        sql: `SELECT COUNT(*) as c FROM documents ${whereSql}`,
        args: params,
      });
      const total = asNumber(totalResult.rows[0]?.c);

      const facets = await getDocumentFacets(db, where, params, {
        typeWhere: typeFacetWhere,
        tagWhere: tagFacetWhere,
      });
      // Defensively skip rows whose `type` doesn't match the public enum (e.g.
      // legacy/partially-migrated data). Throwing here would 500 the whole
      // list response on a single bad row.
      const validTypeRows = facets.types.flatMap((row) => {
        const parsed = DocumentTypeSchema.safeParse(row.value);
        return parsed.success ? [{ value: parsed.data, count: row.count }] : [];
      });
      const availableTypes = validTypeRows.map((row) => row.value);
      facets.types = validTypeRows;
      facets.tags = facets.tags.filter((row) => row.value.length > 0);

      const listResult = await db.execute({
        sql: `SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM documents ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`,
        args: { ...params, limit, offset },
      });
      const rows = listResult.rows.map(rowToDocumentRow);

      // Single batched provenance fetch instead of N+1 per-row queries — see
      // getFieldProvenanceForDocuments for the why.
      const provenanceByDoc = await getFieldProvenanceForDocuments(
        db,
        rows.map((row) => row.id),
      );
      const items = rows.map((row) => {
        const doc = rowToDocument(row);
        const fp = provenanceByDoc.get(row.id);
        if (fp && Object.keys(fp).length > 0) {
          doc.fieldProvenance = fp;
        }
        return doc;
      });

      setPublicCache(res);
      return res.json({ items, total, availableTypes, facets });
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
      setPublicCache(res);
      return res.status(200).send(artifact.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      console.error('[documents] export failed', err);
      return res.status(500).json({ error: 'Export failed', details: message });
    }
  });

  router.get('/:id', async (req, res) => {
    const id = req.params.id;
    const includeTeiXml = req.query.include === 'teiXml';
    try {
      const result = await db.execute({
        sql: `SELECT ${DOCUMENT_DETAIL_COLUMNS}, ${includeTeiXml ? 'tei_xml' : 'NULL AS tei_xml'}
                FROM documents
               WHERE id = ?`,
        args: [id],
      });
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }
      const docRow = rowToDocumentRow(result.rows[0]!);
      setPublicCache(res);
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
