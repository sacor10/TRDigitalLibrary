import type { InValue } from '@libsql/client';
import {
  DocumentListQuerySchema,
  DocumentPatchSchema,
  DocumentTypeSchema,
  OnThisDayQuerySchema,
} from '@tr/shared';
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
  asString,
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
    const { type, dateFrom, dateTo, recipient, tag, source, sort, order, limit, offset } =
      parsed.data;

    const where: string[] = [];
    const typeFacetWhere: string[] = [];
    const tagFacetWhere: string[] = [];
    const sourceFacetWhere: string[] = [];
    const params: Record<string, InValue> = {};
    const addFilter = (
      sql: string,
      except: 'type' | 'tag' | 'source' | null = null,
    ): void => {
      where.push(sql);
      if (except !== 'type') typeFacetWhere.push(sql);
      if (except !== 'tag') tagFacetWhere.push(sql);
      if (except !== 'source') sourceFacetWhere.push(sql);
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
    if (source) {
      addFilter('documents.source = @source', 'source');
      params.source = source;
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
        sourceWhere: sourceFacetWhere,
      });
      const availableTypes = facets.types.map((row) => DocumentTypeSchema.parse(row.value));

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

  // Must precede the `/:id` routes so "on-this-day" isn't captured as an id.
  router.get('/on-this-day', async (req, res) => {
    const parsed = OnThisDayQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { date, limit } = parsed.data;
    // Default to today's month-day in UTC when no override is given.
    const monthDay = date ?? new Date().toISOString().slice(5, 10);
    try {
      const result = await db.execute({
        // Same substr(date, 6, 5) expression as idx_documents_monthday so the
        // expression index is used.
        sql: `SELECT ${DOCUMENT_SUMMARY_COLUMNS}
                FROM documents
               WHERE substr(documents.date, 6, 5) = @monthDay
               ORDER BY documents.date ASC
               LIMIT @limit`,
        args: { monthDay, limit },
      });
      const items = result.rows.map((row) => rowToDocument(rowToDocumentRow(row)));
      setPublicCache(res);
      return res.json({ monthDay, items });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[documents] on-this-day failed', err);
      return res.status(500).json({ error: 'Failed to load on-this-day', details: message });
    }
  });

  // Related documents: shared topics, same recipient, temporal proximity.
  // Candidates come from indexed topic/recipient joins, so this never scans the
  // whole corpus. Registered before `/:id` so "related" isn't captured as an id.
  router.get('/:id/related', async (req, res) => {
    const id = req.params.id;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 8) || 8, 1), 50);
    try {
      const selfResult = await db.execute({
        sql: 'SELECT id, date, recipient FROM documents WHERE id = ?',
        args: [id],
      });
      if (selfResult.rows.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }
      const self = selfResult.rows[0]!;
      const selfDate = asString(self.date);
      const selfRecipient = self.recipient == null ? null : asString(self.recipient);

      // Shared-topic candidates with a count of overlapping topics.
      const topicResult = await db.execute({
        sql: `SELECT dta2.document_id AS id, COUNT(*) AS shared
                FROM document_topic_assignments dta1
                JOIN document_topic_assignments dta2 ON dta1.topic = dta2.topic
               WHERE dta1.document_id = @id AND dta2.document_id != @id
               GROUP BY dta2.document_id`,
        args: { id },
      });
      const sharedByDoc = new Map<string, number>();
      for (const row of topicResult.rows) {
        sharedByDoc.set(asString(row.id), asNumber(row.shared));
      }

      // Same-recipient candidates (only when this document has a recipient).
      const recipientMatches = new Set<string>();
      if (selfRecipient) {
        const recResult = await db.execute({
          sql: `SELECT id FROM documents WHERE recipient = @recipient AND id != @id LIMIT 200`,
          args: { recipient: selfRecipient, id },
        });
        for (const row of recResult.rows) recipientMatches.add(asString(row.id));
      }

      const candidateIds = new Set<string>([...sharedByDoc.keys(), ...recipientMatches]);
      if (candidateIds.size === 0) {
        setPublicCache(res);
        return res.json({ items: [] });
      }

      const ids = [...candidateIds];
      const placeholders = ids.map(() => '?').join(', ');
      const docResult = await db.execute({
        sql: `SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM documents WHERE id IN (${placeholders})`,
        args: ids,
      });

      const selfYear = Number(selfDate.slice(0, 4));
      const scored = docResult.rows
        .map((row) => {
          const docRow = rowToDocumentRow(row);
          const doc = rowToDocument(docRow);
          const sharedTopics = sharedByDoc.get(doc.id) ?? 0;
          const sameRecipient = recipientMatches.has(doc.id);
          const yearsApart = Math.abs((Number(doc.date.slice(0, 4)) || selfYear) - selfYear);
          const temporal = 1 / (1 + yearsApart);
          const reasons: Array<'shared-topic' | 'same-recipient' | 'temporal-proximity'> = [];
          if (sharedTopics > 0) reasons.push('shared-topic');
          if (sameRecipient) reasons.push('same-recipient');
          if (yearsApart <= 1) reasons.push('temporal-proximity');
          const score = sharedTopics * 3 + (sameRecipient ? 2 : 0) + temporal;
          return { document: doc, score, reasons };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      setPublicCache(res);
      return res.json({ items: scored });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[documents] related failed', err);
      return res.status(500).json({ error: 'Failed to load related documents', details: message });
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
