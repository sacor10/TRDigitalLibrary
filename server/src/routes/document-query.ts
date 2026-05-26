import type { InValue } from '@libsql/client';

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
}

export function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

export function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

// Strips entries from `params` whose @name doesn't appear in `sql`. libsql's
// HTTP transport rejects statements that bind a named parameter the SQL
// doesn't reference, so the per-facet queries (which include/exclude
// different WHERE clauses than the main list query) must be handed a
// matching subset of args.
export function pickReferencedParams(
  sql: string,
  params: Record<string, InValue>,
): Record<string, InValue> {
  const out: Record<string, InValue> = {};
  for (const [name, value] of Object.entries(params)) {
    if (new RegExp(`@${name}\\b`).test(sql)) out[name] = value;
  }
  return out;
}

export async function getDocumentFacets(
  db: LibsqlClient,
  where: readonly string[],
  params: Record<string, InValue>,
  opts: { typeWhere?: readonly string[]; tagWhere?: readonly string[] } = {},
): Promise<Facets> {
  const typeWhereSql = (opts.typeWhere ?? where).length
    ? `WHERE ${(opts.typeWhere ?? where).join(' AND ')}`
    : '';
  const tagWhereSql = (opts.tagWhere ?? where).length
    ? `WHERE ${(opts.tagWhere ?? where).join(' AND ')}`
    : '';

  const typeSql = `SELECT documents.type AS value, COUNT(*) AS count
              FROM documents
              ${typeWhereSql}
             GROUP BY documents.type
             ORDER BY documents.type ASC`;
  const tagSql = `SELECT dta.topic AS value, COUNT(DISTINCT documents.id) AS count
              FROM documents
              JOIN document_topic_assignments dta ON dta.document_id = documents.id
              ${tagWhereSql}
             GROUP BY dta.topic
             ORDER BY count DESC, dta.topic ASC
             LIMIT 50`;

  const [typeResult, tagResult] = await Promise.all([
    db.execute({ sql: typeSql, args: pickReferencedParams(typeSql, params) }),
    db.execute({ sql: tagSql, args: pickReferencedParams(tagSql, params) }),
  ]);

  return {
    types: typeResult.rows.map((row) => ({ value: asString(row.value), count: asNumber(row.count) })),
    tags: tagResult.rows.map((row) => ({ value: asString(row.value), count: asNumber(row.count) })),
  };
}

