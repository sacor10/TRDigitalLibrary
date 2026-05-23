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

  const [typeResult, tagResult] = await Promise.all([
    db.execute({
      sql: `SELECT documents.type AS value, COUNT(*) AS count
              FROM documents
              ${typeWhereSql}
             GROUP BY documents.type
             ORDER BY documents.type ASC`,
      args: params,
    }),
    db.execute({
      sql: `SELECT dta.topic AS value, COUNT(DISTINCT documents.id) AS count
              FROM documents
              JOIN document_topic_assignments dta ON dta.document_id = documents.id
              ${tagWhereSql}
             GROUP BY dta.topic
             ORDER BY count DESC, dta.topic ASC
             LIMIT 50`,
      args: params,
    }),
  ]);

  return {
    types: typeResult.rows.map((row) => ({ value: asString(row.value), count: asNumber(row.count) })),
    tags: tagResult.rows.map((row) => ({ value: asString(row.value), count: asNumber(row.count) })),
  };
}

