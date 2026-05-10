import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openInMemoryDatabase, type LibsqlClient } from '../db.js';
import { ingestTeiFolder } from '../ingest/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'ingest', '__tests__', 'fixtures');

function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

describe('ingestTeiFolder (integration)', () => {
  let db: LibsqlClient;

  beforeAll(async () => {
    db = await openInMemoryDatabase();
  });

  afterAll(() => {
    db.close();
  });

  it('reports invalid + valid files and writes only the valid ones', async () => {
    const report = await ingestTeiFolder(fixturesDir, db);

    expect(report.scanned).toBe(4);
    expect(report.valid).toBe(2);
    expect(report.invalid).toBe(2);
    expect(report.written).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.skipped).toBe(0);

    const docCount = await db.execute('SELECT COUNT(*) AS c FROM documents');
    expect(asNumber(docCount.rows[0]?.c)).toBe(2);

    const hashes = await db.execute(
      'SELECT id, tei_source_hash FROM documents WHERE tei_source_hash IS NOT NULL',
    );
    expect(hashes.rows.length).toBe(2);
    for (const r of hashes.rows) {
      expect(String(r.tei_source_hash)).toMatch(/^[0-9a-f]{64}$/);
    }

    const letterResult = await db.execute({
      sql: 'SELECT id, title, type, date, transcription_format, tei_xml FROM documents WHERE id = ?',
      args: ['tr-to-lodge-1898-04-26'],
    });
    expect(letterResult.rows.length).toBe(1);
    const letter = letterResult.rows[0]!;
    expect(String(letter.type)).toBe('letter');
    expect(String(letter.date)).toBe('1898-04-26');
    expect(String(letter.transcription_format)).toBe('tei-xml');
    expect(String(letter.tei_xml)).toMatch(/Rough Riders/);

    const sectionsResult = await db.execute({
      sql: 'SELECT type, level, n, heading, parent_id FROM document_sections WHERE document_id = ? ORDER BY "order"',
      args: ['tr-to-lodge-1898-04-26'],
    });
    const sections = sectionsResult.rows.map((s) => ({
      type: String(s.type),
      level: asNumber(s.level),
      n: s.n == null ? null : String(s.n),
      heading: s.heading == null ? null : String(s.heading),
      parent_id: s.parent_id == null ? null : String(s.parent_id),
    }));
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

  it('section-level FTS finds inserted body text', async () => {
    const result = await db.execute({
      sql: `SELECT document_sections.document_id AS id
              FROM sections_fts
              JOIN document_sections ON document_sections.rowid = sections_fts.rowid
              WHERE sections_fts MATCH ?
              LIMIT 1`,
      args: ['"strenuous"'],
    });
    expect(String(result.rows[0]?.id)).toBe('strenuous-life-1899');
  });

  it('document-level FTS still works for the new TEI documents', async () => {
    const result = await db.execute({
      sql: `SELECT documents.id AS id
              FROM documents_fts
              JOIN documents ON documents.rowid = documents_fts.rowid
              WHERE documents_fts MATCH ?
              LIMIT 1`,
      args: ['"Rough"'],
    });
    expect(String(result.rows[0]?.id)).toBe('tr-to-lodge-1898-04-26');
  });

  it('replays the same folder idempotently (re-ingest skips unchanged files)', async () => {
    const before = await db.execute({
      sql: 'SELECT COUNT(*) AS c FROM document_sections WHERE document_id = ?',
      args: ['tr-to-lodge-1898-04-26'],
    });
    const report = await ingestTeiFolder(fixturesDir, db);
    const after = await db.execute({
      sql: 'SELECT COUNT(*) AS c FROM document_sections WHERE document_id = ?',
      args: ['tr-to-lodge-1898-04-26'],
    });
    expect(asNumber(after.rows[0]?.c)).toBe(asNumber(before.rows[0]?.c));
    expect(report.written).toBe(0);
    expect(report.updated).toBe(0);
    // Both valid TEI files are now skipped because their tei_source_hash
    // matches what we wrote on the first ingest.
    expect(report.skipped).toBe(2);
    expect(
      report.results.filter((r) => r.status === 'skipped').length,
    ).toBe(2);
  });

  it('--force re-ingests every valid file regardless of cached hash', async () => {
    const report = await ingestTeiFolder(fixturesDir, db, { force: true });
    // With --force, the hash-cache shortcut is bypassed. Both files re-run
    // through the upsert + replaceSections path; because the rows already
    // exist, they go onto the `updated` counter rather than `written`.
    expect(report.written).toBe(0);
    expect(report.updated).toBe(2);
    expect(report.skipped).toBe(0);
  });

  it('dry-run does not write to the database', async () => {
    const inMem = await openInMemoryDatabase();
    const report = await ingestTeiFolder(fixturesDir, inMem, { dryRun: true });
    expect(report.valid).toBe(2);
    expect(report.written).toBe(0);
    const count = await inMem.execute('SELECT COUNT(*) AS c FROM documents');
    expect(asNumber(count.rows[0]?.c)).toBe(0);
    inMem.close();
  });
});
