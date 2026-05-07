import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import type { Database as DatabaseT } from 'better-sqlite3';

import type { Document, DocumentPatch, DocumentSection, FieldProvenance } from '@tr/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'data', 'library.db');

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
  teiXml: 'tei_xml',
};

function fieldValueFromDocument(doc: Document, field: ProvenanceField): unknown {
  return doc[field];
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
    teiXml: row.tei_xml,
  };
}

export function openDatabase(path: string = DEFAULT_DB_PATH): DatabaseT {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function openInMemoryDatabase(): DatabaseT {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: DatabaseT): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const isApplied = db.prepare('SELECT 1 AS x FROM schema_migrations WHERE id = ?');
  const record = db.prepare('INSERT INTO schema_migrations (id) VALUES (?)');

  const apply = db.transaction((file: string, sql: string) => {
    db.exec(sql);
    record.run(file);
  });

  for (const file of files) {
    if (isApplied.get(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    apply(file, sql);
  }
}

export function upsertDocument(
  db: DatabaseT,
  doc: Document,
  ctx?: ProvenanceContext,
): void {
  const stmt = db.prepare(`
    INSERT INTO documents (
      id, title, type, date, recipient, location, author,
      transcription, transcription_url, transcription_format,
      facsimile_url, iiif_manifest_url, provenance, source, source_url, tags, tei_xml
    ) VALUES (
      @id, @title, @type, @date, @recipient, @location, @author,
      @transcription, @transcription_url, @transcription_format,
      @facsimile_url, @iiif_manifest_url, @provenance, @source, @source_url, @tags, @tei_xml
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
      tei_xml = excluded.tei_xml
  `);

  const run = (): void => {
    stmt.run({
      id: doc.id,
      title: doc.title,
      type: doc.type,
      date: doc.date,
      recipient: doc.recipient,
      location: doc.location,
      author: doc.author,
      transcription: doc.transcription,
      transcription_url: doc.transcriptionUrl,
      transcription_format: doc.transcriptionFormat,
      facsimile_url: doc.facsimileUrl,
      iiif_manifest_url: doc.iiifManifestUrl ?? null,
      provenance: doc.provenance,
      source: doc.source,
      source_url: doc.sourceUrl,
      tags: JSON.stringify(doc.tags),
      tei_xml: doc.teiXml ?? null,
    });
    if (ctx) {
      for (const field of PROVENANCE_FIELDS) {
        recordFieldProvenance(db, doc.id, field, ctx);
      }
    }
  };

  if (ctx) {
    db.transaction(run)();
  } else {
    run();
  }
}

function recordFieldProvenance(
  db: DatabaseT,
  documentId: string,
  field: ProvenanceField,
  ctx: ProvenanceContext,
): void {
  db.prepare(
    `INSERT INTO document_field_provenance (document_id, field, source_url, fetched_at, editor)
     VALUES (@document_id, @field, @source_url, @fetched_at, @editor)
     ON CONFLICT(document_id, field) DO UPDATE SET
       source_url = excluded.source_url,
       fetched_at = excluded.fetched_at,
       editor = excluded.editor`,
  ).run({
    document_id: documentId,
    field,
    source_url: ctx.sourceUrl,
    fetched_at: ctx.fetchedAt,
    editor: ctx.editor,
  });
}

export function getFieldProvenance(
  db: DatabaseT,
  documentId: string,
): Record<string, FieldProvenance> {
  const rows = db
    .prepare(
      `SELECT field, source_url AS sourceUrl, fetched_at AS fetchedAt, editor
       FROM document_field_provenance
       WHERE document_id = ?`,
    )
    .all(documentId) as Array<{
    field: string;
    sourceUrl: string | null;
    fetchedAt: string;
    editor: string;
  }>;
  const out: Record<string, FieldProvenance> = {};
  for (const row of rows) {
    out[row.field] = {
      sourceUrl: row.sourceUrl,
      fetchedAt: row.fetchedAt,
      editor: row.editor,
    };
  }
  return out;
}

export function rowToDocumentWithProvenance(db: DatabaseT, row: DocumentRow): Document {
  const doc = rowToDocument(row);
  const fieldProvenance = getFieldProvenance(db, row.id);
  if (Object.keys(fieldProvenance).length > 0) {
    doc.fieldProvenance = fieldProvenance;
  }
  return doc;
}

export function patchDocumentFields(
  db: DatabaseT,
  documentId: string,
  patch: DocumentPatch,
  ctx: ProvenanceContext,
): Document | null {
  const existing = db
    .prepare('SELECT * FROM documents WHERE id = ?')
    .get(documentId) as DocumentRow | undefined;
  if (!existing) return null;

  const current = rowToDocument(existing);
  const entries = Object.entries(patch) as Array<[ProvenanceField, unknown]>;
  if (entries.length === 0) return rowToDocumentWithProvenance(db, existing);

  const setClauses: string[] = [];
  const params: Record<string, unknown> = { id: documentId };
  const changed: Array<{ field: ProvenanceField; previous: unknown; next: unknown }> = [];

  for (const [field, nextValue] of entries) {
    const column = FIELD_TO_COLUMN[field];
    setClauses.push(`${column} = @${column}`);
    params[column] = field === 'tags' ? JSON.stringify(nextValue ?? []) : (nextValue ?? null);
    const previous = fieldValueFromDocument(current, field);
    if (JSON.stringify(previous) !== JSON.stringify(nextValue)) {
      changed.push({ field, previous, next: nextValue });
    }
  }

  const updateSql = `UPDATE documents SET ${setClauses.join(', ')} WHERE id = @id`;
  const updateStmt = db.prepare(updateSql);
  const historyStmt = db.prepare(
    `INSERT INTO document_field_provenance_history
       (document_id, field, previous_value, new_value, source_url, fetched_at, editor)
     VALUES (@document_id, @field, @previous_value, @new_value, @source_url, @fetched_at, @editor)`,
  );

  db.transaction(() => {
    updateStmt.run(params);
    for (const [field] of entries) {
      recordFieldProvenance(db, documentId, field, ctx);
    }
    for (const change of changed) {
      historyStmt.run({
        document_id: documentId,
        field: change.field,
        previous_value: JSON.stringify(change.previous ?? null),
        new_value: JSON.stringify(change.next ?? null),
        source_url: ctx.sourceUrl,
        fetched_at: ctx.fetchedAt,
        editor: ctx.editor,
      });
    }
  })();

  const updated = db
    .prepare('SELECT * FROM documents WHERE id = ?')
    .get(documentId) as DocumentRow;
  return rowToDocumentWithProvenance(db, updated);
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

export function getSectionsByDocumentId(
  db: DatabaseT,
  documentId: string,
): DocumentSection[] {
  const rows = db
    .prepare(
      `SELECT id, document_id, parent_id, "order", level, type, n, heading, text, xml_fragment
       FROM document_sections
       WHERE document_id = ?
       ORDER BY "order"`,
    )
    .all(documentId) as SectionRow[];
  return rows.map((row) => ({
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

export function replaceSections(
  db: DatabaseT,
  documentId: string,
  sections: DocumentSection[],
): void {
  const del = db.prepare('DELETE FROM document_sections WHERE document_id = ?');
  const ins = db.prepare(`
    INSERT INTO document_sections (
      id, document_id, parent_id, "order", level, type, n, heading, text, xml_fragment
    ) VALUES (
      @id, @document_id, @parent_id, @order, @level, @type, @n, @heading, @text, @xml_fragment
    )
  `);

  const tx = db.transaction((docId: string, secs: DocumentSection[]) => {
    del.run(docId);
    for (const s of secs) {
      ins.run({
        id: s.id,
        document_id: s.documentId,
        parent_id: s.parentId,
        order: s.order,
        level: s.level,
        type: s.type,
        n: s.n,
        heading: s.heading,
        text: s.text,
        xml_fragment: s.xmlFragment,
      });
    }
  });

  tx(documentId, sections);
}
