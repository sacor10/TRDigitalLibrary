import type { InValue } from '@libsql/client';
import { SearchQuerySchema } from '@tr/shared';
import { Router } from 'express';

import { rowToDocument, rowToDocumentRow, type LibsqlClient } from '../db.js';
import { setPublicCache } from '../http-cache.js';

import { DOCUMENT_SUMMARY_COLUMNS, asNumber, asString } from './document-query.js';

const FTS_FIELD_MAP: Record<string, string> = {
  title: 'title',
  recipient: 'recipient',
  tag: 'tags',
  tags: 'tags',
};

function quoteFtsToken(raw: string): string {
  return `"${raw.replace(/"/g, '""')}"`;
}

function terms(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((t) => t.length > 0)
    .map(quoteFtsToken);
}

function buildFtsQuery(raw: string): { ftsQuery: string; where: string[]; params: Record<string, InValue> } {
  const where: string[] = [];
  const params: Record<string, InValue> = {};
  const tokens: string[] = [];
  let structuredIndex = 0;

  for (const part of raw.split(/\s+/)) {
    const match = part.match(/^([A-Za-z]+):(.+)$/);
    if (!match) {
      tokens.push(...terms(part));
      continue;
    }
    const field = match[1] ?? '';
    const value = match[2] ?? '';
    const normalizedField = field.toLowerCase();
    const cleaned = value.trim();
    if (!cleaned) continue;
    const ftsField = FTS_FIELD_MAP[normalizedField];
    if (ftsField) {
      const scopedTerms = terms(cleaned);
      tokens.push(...scopedTerms.map((term) => `${ftsField}:${term}`));
      continue;
    }
    const key = `structured_${structuredIndex++}`;
    if (normalizedField === 'date') {
      if (/^\d{4}$/.test(cleaned)) {
        where.push(`documents.date >= @${key}_from AND documents.date <= @${key}_to`);
        params[`${key}_from`] = `${cleaned}-01-01`;
        params[`${key}_to`] = `${cleaned}-12-31`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
        where.push(`documents.date = @${key}`);
        params[key] = cleaned;
      }
      continue;
    }
    if (normalizedField === 'collection' || normalizedField === 'source') {
      where.push(`documents.source LIKE @${key}`);
      params[key] = `%${cleaned}%`;
      continue;
    }
    tokens.push(...terms(part));
  }

  if (tokens.length === 0) {
    return { ftsQuery: '""', where, params };
  }
  return { ftsQuery: tokens.join(' AND '), where, params };
}

export function createSearchRouter(db: LibsqlClient): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const parsed = SearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { q, type, dateFrom, dateTo, recipient, tag, source, limit, offset } = parsed.data;
    const parsedQuery = buildFtsQuery(q);
    let ftsQuery = parsedQuery.ftsQuery;

    const where: string[] = ['documents_fts MATCH @ftsQuery', ...parsedQuery.where];
    const typeFacetWhere: string[] = ['documents_fts MATCH @ftsQuery', ...parsedQuery.where];
    const tagFacetWhere: string[] = ['documents_fts MATCH @ftsQuery', ...parsedQuery.where];
    const sourceFacetWhere: string[] = ['documents_fts MATCH @ftsQuery', ...parsedQuery.where];
    const filterParams: Record<string, InValue> = { ftsQuery, ...parsedQuery.params };
    const addFilter = (sql: string, except: 'type' | 'tag' | 'source' | null = null): void => {
      where.push(sql);
      if (except !== 'type') typeFacetWhere.push(sql);
      if (except !== 'tag') tagFacetWhere.push(sql);
      if (except !== 'source') sourceFacetWhere.push(sql);
    };
    if (type) {
      addFilter('documents.type = @type', 'type');
      filterParams.type = type;
    }
    if (dateFrom) {
      addFilter('documents.date >= @dateFrom');
      filterParams.dateFrom = dateFrom;
    }
    if (dateTo) {
      addFilter('documents.date <= @dateTo');
      filterParams.dateTo = dateTo;
    }
    if (source) {
      addFilter('documents.source = @source', 'source');
      filterParams.source = source;
    }
    if (recipient) {
      const recipientTerms = terms(recipient).map((term) => `recipient:${term}`);
      if (recipientTerms.length > 0) {
        ftsQuery = [ftsQuery, ...recipientTerms].join(' AND ');
        filterParams.ftsQuery = ftsQuery;
      }
    }
    if (tag !== undefined) {
      addFilter(
        'EXISTS (SELECT 1 FROM document_topic_assignments dta_filter WHERE dta_filter.document_id = documents.id AND dta_filter.topic = @tag)',
        'tag',
      );
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
        setPublicCache(res);
        return res.json({
          results: [],
          total: 0,
          facets: { types: [], tags: [], sources: [] },
        });
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

      const facetFromWhere = (facetWhere: readonly string[], includeTopics = false) => `FROM documents_fts
        JOIN documents ON documents.rowid = documents_fts.rowid
        ${includeTopics ? 'JOIN document_topic_assignments dta ON dta.document_id = documents.id' : ''}
        WHERE ${facetWhere.join(' AND ')}`;
      const [typeFacetResult, tagFacetResult, sourceFacetResult] = await Promise.all([
        db.execute({
          sql: `SELECT documents.type AS value, COUNT(*) AS count
                  ${facetFromWhere(typeFacetWhere)}
                 GROUP BY documents.type
                 ORDER BY documents.type ASC`,
          args: filterParams,
        }),
        db.execute({
          sql: `SELECT dta.topic AS value, COUNT(DISTINCT documents.id) AS count
                  ${facetFromWhere(tagFacetWhere, true)}
                 GROUP BY dta.topic
                 ORDER BY count DESC, dta.topic ASC
                 LIMIT 50`,
          args: filterParams,
        }),
        db.execute({
          sql: `SELECT documents.source AS value, COUNT(*) AS count
                  ${facetFromWhere(sourceFacetWhere)}
                 GROUP BY documents.source
                 ORDER BY count DESC, documents.source ASC
                 LIMIT 50`,
          args: filterParams,
        }),
      ]);

      setPublicCache(res);
      return res.json({
        results: hydrateResult.rows.map((row) => ({
          document: rowToDocument(rowToDocumentRow(row)),
          snippet: asString(row.snippet),
        })),
        total,
        facets: {
          types: typeFacetResult.rows.map((row) => ({
            value: asString(row.value),
            count: asNumber(row.count),
          })),
          tags: tagFacetResult.rows.map((row) => ({
            value: asString(row.value),
            count: asNumber(row.count),
          })),
          sources: sourceFacetResult.rows
            .filter((row) => asString(row.value).length > 0)
            .map((row) => ({
              value: asString(row.value),
              count: asNumber(row.count),
            })),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: 'Invalid search', details: message });
    }
  });

  return router;
}
