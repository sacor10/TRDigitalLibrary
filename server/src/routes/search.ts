import type { InValue } from '@libsql/client';
import { SearchQuerySchema } from '@tr/shared';
import { Router } from 'express';

import { rowToDocument, rowToDocumentRow, type LibsqlClient } from '../db.js';
import { embedText } from '../embeddings/model.js';
import { cosineSimilarity, decodeEmbedding, hybridScores } from '../embeddings/vector.js';
import { setPublicCache } from '../http-cache.js';

import { DOCUMENT_SUMMARY_COLUMNS, asNumber, asString } from './document-query.js';

// For semantic/hybrid we re-rank a bounded BM25 candidate pool by embedding
// similarity, so per-query cost stays independent of corpus size.
const SEMANTIC_CANDIDATE_CAP = 200;

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

export interface CreateSearchRouterOptions {
  /** Injectable query embedder (defaults to the local model). Returns null
   *  when embeddings are unavailable, triggering graceful lexical fallback. */
  embedQuery?: (text: string) => Promise<Float32Array | null>;
}

export function createSearchRouter(
  db: LibsqlClient,
  opts: CreateSearchRouterOptions = {},
): Router {
  const router = Router();
  const embedQuery = opts.embedQuery ?? embedText;

  router.get('/', async (req, res) => {
    const parsed = SearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    }
    const { q, type, dateFrom, dateTo, recipient, tag, source, mode, alpha, limit, offset } =
      parsed.data;
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

    // Phase 1: rank by BM25, no snippets (deferred to hydration so ranking never
    // materializes transcriptions — the original 21s bug). bm25() must live in a
    // SELECT that references documents_fts directly and can't share a SELECT with
    // a window function, so it runs in the inner subquery; the outer SELECT adds
    // COUNT(*) OVER () and pagination. For semantic/hybrid we pull a larger
    // candidate pool (offset 0) and re-rank it by embedding similarity below.
    const wantSemantic = mode !== 'lexical';
    const rankLimit = wantSemantic ? SEMANTIC_CANDIDATE_CAP : limit;
    const rankOffset = wantSemantic ? 0 : offset;
    const rankSql = `
      SELECT inner_q.rowid AS rowid, inner_q.id AS id, inner_q.rank AS rank,
             COUNT(*) OVER () AS total_count
      FROM (
        SELECT documents.rowid AS rowid, documents.id AS id, bm25(documents_fts) AS rank
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
        args: { ...filterParams, limit: rankLimit, offset: rankOffset },
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
      const candidates = rankResult.rows.map((r) => ({
        rowid: asNumber(r.rowid),
        id: asString(r.id),
        rank: Number(r.rank),
      }));

      // Re-rank the candidate pool by embedding similarity for semantic/hybrid.
      // Degrades to BM25 order if the model or embeddings are unavailable, so
      // search always returns results regardless of the embedding backend.
      let responseMode: 'lexical' | 'semantic' | 'hybrid' = 'lexical';
      let ordered = candidates;
      const scoreByRowid = new Map<number, number>();
      if (wantSemantic) {
        const queryVec = await embedQuery(q);
        const embByDoc = new Map<string, Float32Array>();
        if (queryVec) {
          const ids = candidates.map((c) => c.id);
          const ph = ids.map(() => '?').join(', ');
          const embResult = await db.execute({
            sql: `SELECT document_id, embedding FROM document_embeddings WHERE document_id IN (${ph})`,
            args: ids,
          });
          for (const row of embResult.rows) {
            embByDoc.set(
              asString(row.document_id),
              decodeEmbedding(row.embedding as unknown as ArrayBuffer | Uint8Array),
            );
          }
        }
        if (queryVec && embByDoc.size > 0) {
          const withCosine = candidates.map((c) => {
            const vec = embByDoc.get(c.id);
            return { ...c, cosine: vec ? cosineSimilarity(queryVec, vec) : undefined };
          });
          const scores =
            mode === 'semantic'
              ? withCosine.map((c) => c.cosine ?? -1)
              : hybridScores(
                  withCosine.map((c) => ({ lexicalScore: c.rank, cosine: c.cosine })),
                  alpha,
                );
          const scored = withCosine
            .map((c, i) => ({ candidate: c, score: scores[i]! }))
            .sort((a, b) => b.score - a.score);
          ordered = scored.map((s) => s.candidate);
          for (const s of scored) scoreByRowid.set(s.candidate.rowid, s.score);
          responseMode = mode;
        }
      }

      // Page slice. For lexical the rank query already returned the page.
      const pageCandidates = wantSemantic ? ordered.slice(offset, offset + limit) : ordered;
      const rowids = pageCandidates.map((c) => c.rowid);
      if (rowids.length === 0) {
        setPublicCache(res);
        return res.json({ results: [], total, facets: { types: [], tags: [], sources: [] } });
      }

      // Phase 2: hydrate only the page. MATCH is required for snippet() to
      // have positions to highlight; rowid IN (...) prunes to the page.
      // CASE preserves the (re-)ranked order without re-scoring.
      const placeholders = rowids.map(() => '?').join(', ');
      const orderCase = rowids.map((_, i) => `WHEN ? THEN ${i}`).join(' ');
      const hydrateSql = `
        SELECT
          documents.rowid AS rowid,
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
        results: hydrateResult.rows.map((row) => {
          const score = scoreByRowid.get(asNumber(row.rowid));
          return {
            document: rowToDocument(rowToDocumentRow(row)),
            snippet: asString(row.snippet),
            ...(score !== undefined ? { score, mode: responseMode } : {}),
          };
        }),
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
