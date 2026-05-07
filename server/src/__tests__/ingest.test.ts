import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Database as DatabaseT } from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openInMemoryDatabase } from '../db.js';
import { ingestTeiFolder } from '../ingest/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'ingest', '__tests__', 'fixtures');

describe('ingestTeiFolder (integration)', () => {
  let db: DatabaseT;

  beforeAll(() => {
    db = openInMemoryDatabase();
  });

  afterAll(() => {
    db.close();
  });

  it('reports invalid + valid files and writes only the valid ones', () => {
    const report = ingestTeiFolder(fixturesDir, db);

    expect(report.scanned).toBe(4);
    expect(report.valid).toBe(2);
    expect(report.invalid).toBe(2);
    expect(report.written).toBe(2);

    const docCount = db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number };
    expect(docCount.c).toBe(2);

    const letter = db
      .prepare('SELECT id, title, type, date, transcription_format, tei_xml FROM documents WHERE id = ?')
      .get('tr-to-lodge-1898-04-26') as
      | {
          id: string;
          title: string;
          type: string;
          date: string;
          transcription_format: string;
          tei_xml: string | null;
        }
      | undefined;
    expect(letter).toBeDefined();
    expect(letter?.type).toBe('letter');
    expect(letter?.date).toBe('1898-04-26');
    expect(letter?.transcription_format).toBe('tei-xml');
    expect(letter?.tei_xml).toMatch(/Rough Riders/);

    const sections = db
      .prepare(
        'SELECT type, level, n, heading, parent_id FROM document_sections WHERE document_id = ? ORDER BY "order"',
      )
      .all('tr-to-lodge-1898-04-26') as Array<{
      type: string;
      level: number;
      n: string | null;
      heading: string | null;
      parent_id: string | null;
    }>;
    expect(sections.length).toBeGreaterThan(0);
    const first = sections[0]!;
    expect(first.type).toBe('div');
    expect(first.level).toBe(0);
    expect(first.heading).toBe('To Henry Cabot Lodge');
    const paragraphs = sections.filter((s) => s.type === 'p');
    expect(paragraphs).toHaveLength(3);
    for (const p of paragraphs) {
      expect(p.parent_id).not.toBeNull();
      expect(p.level).toBe(1);
    }
  });

  it('section-level FTS finds inserted body text', () => {
    const row = db
      .prepare(
        `SELECT document_sections.document_id AS id
         FROM sections_fts
         JOIN document_sections ON document_sections.rowid = sections_fts.rowid
         WHERE sections_fts MATCH ?
         LIMIT 1`,
      )
      .get('"strenuous"') as { id: string } | undefined;
    expect(row?.id).toBe('strenuous-life-1899');
  });

  it('document-level FTS still works for the new TEI documents', () => {
    const row = db
      .prepare(
        `SELECT documents.id AS id
         FROM documents_fts
         JOIN documents ON documents.rowid = documents_fts.rowid
         WHERE documents_fts MATCH ?
         LIMIT 1`,
      )
      .get('"Rough"') as { id: string } | undefined;
    expect(row?.id).toBe('tr-to-lodge-1898-04-26');
  });

  it('replays the same folder idempotently (re-ingest replaces sections)', () => {
    const before = db
      .prepare('SELECT COUNT(*) AS c FROM document_sections WHERE document_id = ?')
      .get('tr-to-lodge-1898-04-26') as { c: number };
    ingestTeiFolder(fixturesDir, db);
    const after = db
      .prepare('SELECT COUNT(*) AS c FROM document_sections WHERE document_id = ?')
      .get('tr-to-lodge-1898-04-26') as { c: number };
    expect(after.c).toBe(before.c);
  });

  it('dry-run does not write to the database', () => {
    const inMem = openInMemoryDatabase();
    const report = ingestTeiFolder(fixturesDir, inMem, { dryRun: true });
    expect(report.valid).toBe(2);
    expect(report.written).toBe(0);
    const count = inMem.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number };
    expect(count.c).toBe(0);
    inMem.close();
  });
});
