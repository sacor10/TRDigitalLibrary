import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import type { Database as DatabaseT } from 'better-sqlite3';

import type { Document, DocumentSection } from '@tr/shared';

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
  provenance: string | null;
  source: string;
  source_url: string | null;
  tags: string;
  tei_xml: string | null;
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

export function upsertDocument(db: DatabaseT, doc: Document): void {
  const stmt = db.prepare(`
    INSERT INTO documents (
      id, title, type, date, recipient, location, author,
      transcription, transcription_url, transcription_format,
      facsimile_url, provenance, source, source_url, tags, tei_xml
    ) VALUES (
      @id, @title, @type, @date, @recipient, @location, @author,
      @transcription, @transcription_url, @transcription_format,
      @facsimile_url, @provenance, @source, @source_url, @tags, @tei_xml
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
      provenance = excluded.provenance,
      source = excluded.source,
      source_url = excluded.source_url,
      tags = excluded.tags,
      tei_xml = excluded.tei_xml
  `);

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
    provenance: doc.provenance,
    source: doc.source,
    source_url: doc.sourceUrl,
    tags: JSON.stringify(doc.tags),
    tei_xml: doc.teiXml ?? null,
  });
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
