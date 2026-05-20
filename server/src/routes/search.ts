import { SearchQuerySchema } from '@tr/shared';
import { Router } from 'express';


import { rowToDocument, rowToDocumentRow, type LibsqlClient } from '../db.js';

const DOCUMENT_SUMMARY_COLUMNS = `
  documents.id,
  documents.title,
  documents.type,
  documents.date,
  documents.recipient,
  documents.location,
  documents.author,
  documents.transcription_url,
  documents.transcription_format,
  documents.facsimile_url,
  documents.iiif_manifest_url,
  documents.provenance,
  documents.source,
  documents.source_url,
  documents.tags,
  documents.mentions,
  documents.tei_source_hash
`;

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
    const { q, type, dateFrom, dateTo, recipient, tag, limit, offset } = parsed.data;
    const ftsQuery = buildFtsQuery(q);

    const where: string[] = ['documents_fts MATCH @ftsQuery'];
    const filterParams: Record<string, string | number> = { ftsQuery };
    if (type) {
      where.push('documents.type = @type');
      filterParams.type = type;
    }
    if (dateFrom) {
      where.push('documents.date >= @dateFrom');
      filterParams.dateFrom = dateFrom;
    }
    if (dateTo) {
      where.push('documents.date <= @dateTo');
      filterParams.dateTo = dateTo;
    }
    if (recipient) {
      where.push('documents.recipient LIKE @recipient');
      filterParams.recipient = `%${recipient}%`;
    }
    if (tag !== undefined) {
      where.push('EXISTS (SELECT 1 FROM json_each(documents.tags) WHERE value = @tag)');
      filterParams.tag = tag;
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    // Phase 1: rank + page rowids + total, no snippets. Computing snippet() in
    // the same SELECT as ORDER BY rank LIMIT forces FTS5 to read every matched
    // row's transcription before truncating, which is what made this 21s.
    //
    // bm25() must live in a SELECT that references documents_fts directly and
    // cannot share a SELECT with a window function (SQLite raises "unable to
    // use function bm25 in the requested context"). So bm25() runs in the
    // inner subquery; the outer SELECT adds COUNT(*) OVER () and pagination.
    const rankSql = `
      SELECT inner_q.rowid AS rowid, inner_q.rank AS rank,
             COUNT(*) OVER () AS total_count
      FROM (
        SELECT documents.rowid AS rowid, bm25(documents_fts) AS rank
        FROM documents_fts
        JOIN documents ON documents.rowid = documents_fts.rowid
        ${whereSql}
      ) AS inner_q
      ORDER BY inner_q.rank
      LIMIT @limit OFFSET @offset
    `;

    try {
      const rankResult = await db.execute({
        sql: rankSql,
        args: { ...filterParams, limit, offset },
      });

      if (rankResult.rows.length === 0) {
        return res.json({ results: [], total: 0 });
      }

      const total = asNumber(rankResult.rows[0]?.total_count);
      const rowids = rankResult.rows.map((r) => asNumber(r.rowid));

      // Phase 2: hydrate only the page. MATCH is required for snippet() to
      // have positions to highlight; rowid IN (...) prunes to ≤limit rows.
      // CASE preserves the rank order from phase 1 without re-scoring.
      const placeholders = rowids.map(() => '?').join(', ');
      const orderCase = rowids.map((_, i) => `WHEN ? THEN ${i}`).join(' ');
      const hydrateSql = `
        SELECT
          ${DOCUMENT_SUMMARY_COLUMNS},
          snippet(documents_fts, -1, '<mark>', '</mark>', '…', 16) AS snippet
        FROM documents_fts
        JOIN documents ON documents.rowid = documents_fts.rowid
        WHERE documents_fts MATCH ?
          AND documents.rowid IN (${placeholders})
        ORDER BY CASE documents.rowid ${orderCase} END
      `;
      const hydrateResult = await db.execute({
        sql: hydrateSql,
        args: [ftsQuery, ...rowids, ...rowids],
      });

      return res.json({
        results: hydrateResult.rows.map((row) => ({
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
