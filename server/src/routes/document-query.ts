import type { InStatement, InValue, Row } from '@libsql/client';

import type { LibsqlClient } from '../db.js';

export const DOCUMENT_SUMMARY_COLUMNS = `
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

export const DOCUMENT_DETAIL_COLUMNS = `
  id, title, type, date, recipient, location, author,
  transcription, transcription_url, transcription_format, facsimile_url,
  iiif_manifest_url, provenance, source, source_url, tags, mentions,
  tei_source_hash
`;

export interface FacetCount {
  value: string;
  count: number;
}

export interface Facets {
  types: FacetCount[];
  tags: FacetCount[];
  sources: FacetCount[];
}

export function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

export function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * Builds the two facet aggregate statements (type counts, topic-tag counts)
 * over the non-FTS `documents` table. Returned as InStatements so callers can
 * fire them concurrently (Promise.all) alongside their own COUNT/list queries —
 * the heavy aggregate scans overlap in one round-trip wave instead of running
 * after the list query.
 */
export function buildDocumentFacetStatements(
  params: Record<string, InValue>,
  opts: {
    where?: readonly string[];
    typeWhere?: readonly string[];
    tagWhere?: readonly string[];
    sourceWhere?: readonly string[];
  } = {},
): { typeStmt: InStatement; tagStmt: InStatement; sourceStmt: InStatement } {
  const base = opts.where ?? [];
  const typeWhere = opts.typeWhere ?? base;
  const tagWhere = opts.tagWhere ?? base;
  const sourceWhere = opts.sourceWhere ?? base;
  const typeWhereSql = typeWhere.length ? `WHERE ${typeWhere.join(' AND ')}` : '';
  const tagWhereSql = tagWhere.length ? `WHERE ${tagWhere.join(' AND ')}` : '';
  const sourceWhereSql = sourceWhere.length ? `WHERE ${sourceWhere.join(' AND ')}` : '';

  return {
    typeStmt: {
      sql: `SELECT documents.type AS value, COUNT(*) AS count
              FROM documents
              ${typeWhereSql}
             GROUP BY documents.type
             ORDER BY documents.type ASC`,
      args: params,
    },
    tagStmt: {
      sql: `SELECT dta.topic AS value, COUNT(DISTINCT documents.id) AS count
              FROM documents
              JOIN document_topic_assignments dta ON dta.document_id = documents.id
              ${tagWhereSql}
             GROUP BY dta.topic
             ORDER BY count DESC, dta.topic ASC
             LIMIT 50`,
      args: params,
    },
    sourceStmt: {
      sql: `SELECT documents.source AS value, COUNT(*) AS count
              FROM documents
              ${sourceWhereSql}
             GROUP BY documents.source
             ORDER BY count DESC, documents.source ASC
             LIMIT 50`,
      args: params,
    },
  };
}

/** Maps the three facet result sets into the Facets response shape. */
export function rowsToFacets(
  typeRows: readonly Row[],
  tagRows: readonly Row[],
  sourceRows: readonly Row[] = [],
): Facets {
  return {
    types: typeRows.map((row) => ({ value: asString(row.value), count: asNumber(row.count) })),
    tags: tagRows.map((row) => ({ value: asString(row.value), count: asNumber(row.count) })),
    sources: sourceRows
      .filter((row) => asString(row.value).length > 0)
      .map((row) => ({ value: asString(row.value), count: asNumber(row.count) })),
  };
}

export async function getDocumentFacets(
  db: LibsqlClient,
  where: readonly string[],
  params: Record<string, InValue>,
  opts: {
    typeWhere?: readonly string[];
    tagWhere?: readonly string[];
    sourceWhere?: readonly string[];
  } = {},
): Promise<Facets> {
  const { typeStmt, tagStmt, sourceStmt } = buildDocumentFacetStatements(params, { where, ...opts });
  const [typeResult, tagResult, sourceResult] = await Promise.all([
    db.execute(typeStmt),
    db.execute(tagStmt),
    db.execute(sourceStmt),
  ]);
  return rowsToFacets(typeResult.rows, tagResult.rows, sourceResult.rows);
}

