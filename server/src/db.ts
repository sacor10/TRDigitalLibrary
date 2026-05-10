import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Client as LibsqlClient,
  Config as LibsqlConfig,
  InStatement,
  InValue,
  Row,
} from '@libsql/client';

import type { Document, DocumentPatch, DocumentSection, FieldProvenance } from '@tr/shared';

const __dirname = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const DEFAULT_LOCAL_FILE = join(__dirname, '..', '..', 'data', 'library.db');
const DEFAULT_LOCAL_URL = `file:${DEFAULT_LOCAL_FILE}`;

export interface DocumentRow {
  id: string;
  title: string;
  type: string;
  date: string;
  recipient: string | null;
  location: string | null;
  author: string;
  transcription: string;
  transcription_url: string | null;
  transcription_format: string;
  facsimile_url: string | null;
  iiif_manifest_url: string | null;
  provenance: string | null;
  source: string;
  source_url: string | null;
  tags: string;
  mentions: string;
  tei_xml: string | null;
}

export const PROVENANCE_FIELDS = [
  'title',
  'type',
  'date',
  'recipient',
  'location',
  'author',
  'transcription',
  'transcriptionUrl',
  'transcriptionFormat',
  'facsimileUrl',
  'iiifManifestUrl',
  'provenance',
  'source',
  'sourceUrl',
  'tags',
  'mentions',
  'teiXml',
] as const;

export type ProvenanceField = (typeof PROVENANCE_FIELDS)[number];

export interface ProvenanceContext {
  sourceUrl: string | null;
  fetchedAt: string;
  editor: string;
}

const FIELD_TO_COLUMN: Record<ProvenanceField, string> = {
  title: 'title',
  type: 'type',
  date: 'date',
  recipient: 'recipient',
  location: 'location',
  author: 'author',
  transcription: 'transcription',
  transcriptionUrl: 'transcription_url',
  transcriptionFormat: 'transcription_format',
  facsimileUrl: 'facsimile_url',
  iiifManifestUrl: 'iiif_manifest_url',
  provenance: 'provenance',
  source: 'source',
  sourceUrl: 'source_url',
  tags: 'tags',
  mentions: 'mentions',
  teiXml: 'tei_xml',
};

function fieldValueFromDocument(doc: Document, field: ProvenanceField): unknown {
  return doc[field];
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNullableString(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function rowToDocumentRow(row: Row): DocumentRow {
  return {
    id: asString(row.id),
    title: asString(row.title),
    type: asString(row.type),
    date: asString(row.date),
    recipient: asNullableString(row.recipient),
    location: asNullableString(row.location),
    author: asString(row.author),
    transcription: asString(row.transcription),
    transcription_url: asNullableString(row.transcription_url),
    transcription_format: asString(row.transcription_format),
    facsimile_url: asNullableString(row.facsimile_url),
    iiif_manifest_url: asNullableString(row.iiif_manifest_url),
    provenance: asNullableString(row.provenance),
    source: asString(row.source),
    source_url: asNullableString(row.source_url),
    tags: asString(row.tags),
    mentions: asString(row.mentions),
    tei_xml: asNullableString(row.tei_xml),
  };
}

export function rowToDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    title: row.title,
    type: row.type as Document['type'],
    date: row.date,
    recipient: row.recipient,
    location: row.location,
    author: row.author,
    transcription: row.transcription,
    transcriptionUrl: row.transcription_url,
    transcriptionFormat: row.transcription_format as Document['transcriptionFormat'],
    facsimileUrl: row.facsimile_url,
    iiifManifestUrl: row.iiif_manifest_url,
    provenance: row.provenance,
    source: row.source,
    sourceUrl: row.source_url,
    tags: JSON.parse(row.tags) as string[],
    mentions: JSON.parse(row.mentions ?? '[]') as string[],
    teiXml: row.tei_xml,
  };
}

export interface OpenLibraryDbOptions {
  url?: string;
  authToken?: string;
}

/**
 * Open a connection to the library DB.
 *
 * Resolution order for the URL:
 *   1. `opts.url`
 *   2. `process.env.TURSO_LIBRARY_DATABASE_URL` (production / Netlify)
 *   3. `file:./data/library.db` (local dev fallback so devs without Turso creds
 *      keep working).
 *
 * Auth token comes from `opts.authToken` or `TURSO_LIBRARY_AUTH_TOKEN`. The
 * library DB is intentionally separate from the annotations DB so the two can
 * point to different Turso instances; see `server/src/annotations-db.ts`.
 */
export async function openLibraryDb(
  opts: OpenLibraryDbOptions = {},
): Promise<LibsqlClient> {
  const url = opts.url ?? process.env.TURSO_LIBRARY_DATABASE_URL ?? DEFAULT_LOCAL_URL;
  const authToken = opts.authToken ?? process.env.TURSO_LIBRARY_AUTH_TOKEN;

  if (url.startsWith('file:')) {
    ensureLocalDirExists(url);
  }

  const client = await createLibsqlClient(url, authToken);
  await runMigrations(client);
  return client;
}

/**
 * Backwards-compatible alias preserved while call sites are migrated.
 * Prefer {@link openLibraryDb} in new code.
 */
export const openDatabase = openLibraryDb;

export async function openInMemoryLibraryDb(): Promise<LibsqlClient> {
  const client = await createLibsqlClient(':memory:');
  await runMigrations(client);
  return client;
}

export const openInMemoryDatabase = openInMemoryLibraryDb;

function ensureLocalDirExists(fileUrl: string): void {
  // file:./data/library.db, file:/abs/data/library.db, file:data/library.db
  const path = fileUrl.replace(/^file:(?:\/\/)?/, '');
  if (!path || path === ':memory:') return;
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // Best effort: createClient will surface a clearer error if the path is unusable.
  }
}

async function createLibsqlClient(
  url: string,
  authToken?: string,
): Promise<LibsqlClient> {
  const config: LibsqlConfig = authToken ? { url, authToken } : { url };
  if (/^(?:libsql|https?):/i.test(url)) {
    const { createClient } = await import('@libsql/client/http');
    return createClient(config);
  }
  const { createClient } = await import('@libsql/client');
  return createClient(config);
}

async function runMigrations(client: LibsqlClient): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const applied = await client.execute({
      sql: 'SELECT 1 FROM schema_migrations WHERE id = ?',
      args: [file],
    });
    if (applied.rows.length > 0) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // executeMultiple is the libsql equivalent of better-sqlite3's db.exec():
    // it runs the entire script as a sequence of statements separated by ';'
    // and correctly handles BEGIN…END trigger bodies (which contain inner ';').
    // A naive split-on-';' splitter would corrupt the FTS5 trigger SQL in
    // 001_init.sql / 002_tei.sql.
    await client.executeMultiple(sql);
    await client.execute({
      sql: 'INSERT INTO schema_migrations (id) VALUES (?)',
      args: [file],
    });
  }
}

const UPSERT_DOCUMENT_SQL = `
  INSERT INTO documents (
    id, title, type, date, recipient, location, author,
    transcription, transcription_url, transcription_format,
    facsimile_url, iiif_manifest_url, provenance, source, source_url, tags, mentions, tei_xml
  ) VALUES (
    @id, @title, @type, @date, @recipient, @location, @author,
    @transcription, @transcription_url, @transcription_format,
    @facsimile_url, @iiif_manifest_url, @provenance, @source, @source_url, @tags, @mentions, @tei_xml
  )
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    type = excluded.type,
    date = excluded.date,
    recipient = excluded.recipient,
    location = excluded.location,
    author = excluded.author,
    transcription = excluded.transcription,
    transcription_url = excluded.transcription_url,
    transcription_format = excluded.transcription_format,
    facsimile_url = excluded.facsimile_url,
    iiif_manifest_url = excluded.iiif_manifest_url,
    provenance = excluded.provenance,
    source = excluded.source,
    source_url = excluded.source_url,
    tags = excluded.tags,
    mentions = excluded.mentions,
    tei_xml = excluded.tei_xml
`;

function upsertDocumentArgs(doc: Document): Record<string, InValue> {
  return {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    date: doc.date,
    recipient: doc.recipient ?? null,
    location: doc.location ?? null,
    author: doc.author,
    transcription: doc.transcription,
    transcription_url: doc.transcriptionUrl ?? null,
    transcription_format: doc.transcriptionFormat,
    facsimile_url: doc.facsimileUrl ?? null,
    iiif_manifest_url: doc.iiifManifestUrl ?? null,
    provenance: doc.provenance ?? null,
    source: doc.source,
    source_url: doc.sourceUrl ?? null,
    tags: JSON.stringify(doc.tags),
    mentions: JSON.stringify(doc.mentions ?? []),
    tei_xml: doc.teiXml ?? null,
  };
}

function provenanceStmt(
  documentId: string,
  field: ProvenanceField,
  ctx: ProvenanceContext,
): InStatement {
  return {
    sql: `INSERT INTO document_field_provenance (document_id, field, source_url, fetched_at, editor)
          VALUES (@document_id, @field, @source_url, @fetched_at, @editor)
          ON CONFLICT(document_id, field) DO UPDATE SET
            source_url = excluded.source_url,
            fetched_at = excluded.fetched_at,
            editor = excluded.editor`,
    args: {
      document_id: documentId,
      field,
      source_url: ctx.sourceUrl ?? null,
      fetched_at: ctx.fetchedAt,
      editor: ctx.editor,
    },
  };
}

export async function upsertDocument(
  client: LibsqlClient,
  doc: Document,
  ctx?: ProvenanceContext,
): Promise<void> {
  const stmts: InStatement[] = [
    { sql: UPSERT_DOCUMENT_SQL, args: upsertDocumentArgs(doc) },
  ];
  if (ctx) {
    for (const field of PROVENANCE_FIELDS) {
      stmts.push(provenanceStmt(doc.id, field, ctx));
    }
  }
  if (stmts.length === 1) {
    await client.execute(stmts[0]!);
  } else {
    await client.batch(stmts, 'write');
  }
}

export async function getFieldProvenance(
  client: LibsqlClient,
  documentId: string,
): Promise<Record<string, FieldProvenance>> {
  const result = await client.execute({
    sql: `SELECT field, source_url, fetched_at, editor
          FROM document_field_provenance
          WHERE document_id = ?`,
    args: [documentId],
  });
  const out: Record<string, FieldProvenance> = {};
  for (const row of result.rows) {
    out[asString(row.field)] = {
      sourceUrl: asNullableString(row.source_url),
      fetchedAt: asString(row.fetched_at),
      editor: asString(row.editor),
    };
  }
  return out;
}

export async function rowToDocumentWithProvenance(
  client: LibsqlClient,
  row: DocumentRow,
): Promise<Document> {
  const doc = rowToDocument(row);
  const fieldProvenance = await getFieldProvenance(client, row.id);
  if (Object.keys(fieldProvenance).length > 0) {
    doc.fieldProvenance = fieldProvenance;
  }
  return doc;
}

export async function patchDocumentFields(
  client: LibsqlClient,
  documentId: string,
  patch: DocumentPatch,
  ctx: ProvenanceContext,
): Promise<Document | null> {
  const existing = await client.execute({
    sql: 'SELECT * FROM documents WHERE id = ?',
    args: [documentId],
  });
  if (existing.rows.length === 0) return null;
  const existingRow = rowToDocumentRow(existing.rows[0]!);
  const current = rowToDocument(existingRow);

  const entries = Object.entries(patch) as Array<[ProvenanceField, unknown]>;
  if (entries.length === 0) return rowToDocumentWithProvenance(client, existingRow);

  const setClauses: string[] = [];
  const params: Record<string, InValue> = { id: documentId };
  const changed: Array<{ field: ProvenanceField; previous: unknown; next: unknown }> = [];

  for (const [field, nextValue] of entries) {
    const column = FIELD_TO_COLUMN[field];
    setClauses.push(`${column} = @${column}`);
    params[column] =
      field === 'tags' || field === 'mentions'
        ? JSON.stringify(nextValue ?? [])
        : ((nextValue ?? null) as InValue);
    const previous = fieldValueFromDocument(current, field);
    if (JSON.stringify(previous) !== JSON.stringify(nextValue)) {
      changed.push({ field, previous, next: nextValue });
    }
  }

  const updateSql = `UPDATE documents SET ${setClauses.join(', ')} WHERE id = @id`;
  const stmts: InStatement[] = [{ sql: updateSql, args: params }];

  for (const [field] of entries) {
    stmts.push(provenanceStmt(documentId, field, ctx));
  }
  for (const change of changed) {
    stmts.push({
      sql: `INSERT INTO document_field_provenance_history
              (document_id, field, previous_value, new_value, source_url, fetched_at, editor)
            VALUES (@document_id, @field, @previous_value, @new_value, @source_url, @fetched_at, @editor)`,
      args: {
        document_id: documentId,
        field: change.field,
        previous_value: JSON.stringify(change.previous ?? null),
        new_value: JSON.stringify(change.next ?? null),
        source_url: ctx.sourceUrl ?? null,
        fetched_at: ctx.fetchedAt,
        editor: ctx.editor,
      },
    });
  }

  await client.batch(stmts, 'write');

  const updated = await client.execute({
    sql: 'SELECT * FROM documents WHERE id = ?',
    args: [documentId],
  });
  if (updated.rows.length === 0) return null;
  return rowToDocumentWithProvenance(client, rowToDocumentRow(updated.rows[0]!));
}

interface SectionRow {
  id: string;
  document_id: string;
  parent_id: string | null;
  order: number;
  level: number;
  type: string;
  n: string | null;
  heading: string | null;
  text: string;
  xml_fragment: string;
}

function rowToSectionRow(row: Row): SectionRow {
  return {
    id: asString(row.id),
    document_id: asString(row.document_id),
    parent_id: asNullableString(row.parent_id),
    order: Number(row.order ?? 0),
    level: Number(row.level ?? 0),
    type: asString(row.type),
    n: asNullableString(row.n),
    heading: asNullableString(row.heading),
    text: asString(row.text),
    xml_fragment: asString(row.xml_fragment),
  };
}

export async function getSectionsByDocumentId(
  client: LibsqlClient,
  documentId: string,
): Promise<DocumentSection[]> {
  const result = await client.execute({
    sql: `SELECT id, document_id, parent_id, "order", level, type, n, heading, text, xml_fragment
          FROM document_sections
          WHERE document_id = ?
          ORDER BY "order"`,
    args: [documentId],
  });
  return result.rows.map(rowToSectionRow).map((row) => ({
    id: row.id,
    documentId: row.document_id,
    parentId: row.parent_id,
    order: row.order,
    level: row.level,
    type: row.type as DocumentSection['type'],
    n: row.n,
    heading: row.heading,
    text: row.text,
    xmlFragment: row.xml_fragment,
  }));
}

export async function replaceSections(
  client: LibsqlClient,
  documentId: string,
  sections: DocumentSection[],
): Promise<void> {
  const stmts: InStatement[] = [
    {
      sql: 'DELETE FROM document_sections WHERE document_id = ?',
      args: [documentId],
    },
    ...sections.map<InStatement>((s) => ({
      sql: `INSERT INTO document_sections (
              id, document_id, parent_id, "order", level, type, n, heading, text, xml_fragment
            ) VALUES (
              @id, @document_id, @parent_id, @order, @level, @type, @n, @heading, @text, @xml_fragment
            )`,
      args: {
        id: s.id,
        document_id: s.documentId,
        parent_id: s.parentId ?? null,
        order: s.order,
        level: s.level,
        type: s.type,
        n: s.n ?? null,
        heading: s.heading ?? null,
        text: s.text,
        xml_fragment: s.xmlFragment,
      },
    })),
  ];
  await client.batch(stmts, 'write');
}

export type { LibsqlClient };
