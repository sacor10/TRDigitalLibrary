/**
 * Validate every document's TEI export against the TEI P5 RelaxNG schema using `xmllint`.
 *
 * Usage: npm run validate-tei -w server
 *
 * Requires `xmllint` (libxml2-utils) on PATH. The script downloads `tei_all.rng`
 * from the TEI Consortium release on first run and caches it under
 * `node_modules/.cache/tr-validate-tei/`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase, getSectionsByDocumentId, rowToDocument, type DocumentRow } from '../src/db.js';
import { generateExport } from '../src/export/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, '..', 'node_modules', '.cache', 'tr-validate-tei');
const RNG_PATH = join(CACHE_DIR, 'tei_all.rng');
const RNG_URL =
  'https://tei-c.org/release/xml/tei/custom/schema/relaxng/tei_all.rng';

function ensureXmllint(): boolean {
  const probe = spawnSync('xmllint', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.error(
      '[validate-tei] `xmllint` not found on PATH. Install libxml2-utils (apt) or libxml2 (brew) and retry.',
    );
    return false;
  }
  return true;
}

async function ensureSchema(): Promise<string | null> {
  if (existsSync(RNG_PATH)) return RNG_PATH;
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`[validate-tei] Fetching ${RNG_URL} → ${RNG_PATH}`);
  try {
    const res = await fetch(RNG_URL);
    if (!res.ok) {
      console.error(
        `[validate-tei] Failed to fetch tei_all.rng: ${res.status} ${res.statusText}`,
      );
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(RNG_PATH, buf);
    return RNG_PATH;
  } catch (err) {
    console.error(`[validate-tei] Network error fetching schema: ${String(err)}`);
    return null;
  }
}

async function main(): Promise<number> {
  if (!ensureXmllint()) return 2;
  const rng = await ensureSchema();
  if (!rng) return 2;

  const dbPath = process.env.DATABASE_URL ?? join(__dirname, '..', '..', 'data', 'library.db');
  if (!existsSync(dbPath)) {
    console.error(`[validate-tei] Database not found at ${dbPath}. Run \`npm run seed\` first.`);
    return 2;
  }
  const db = openDatabase(dbPath);
  const rows = db.prepare('SELECT * FROM documents ORDER BY id').all() as DocumentRow[];

  let failures = 0;
  const tmp = tmpdir();
  for (const row of rows) {
    const doc = rowToDocument(row);
    const sections = getSectionsByDocumentId(db, doc.id);
    const artifact = await generateExport(doc, sections, 'tei');
    const file = join(tmp, `${doc.id}.tei.xml`);
    writeFileSync(file, artifact.body);
    const result = spawnSync(
      'xmllint',
      ['--noout', '--relaxng', rng, file],
      { encoding: 'utf8' },
    );
    if (result.status === 0) {
      console.log(`[validate-tei] OK   ${doc.id}`);
    } else {
      failures += 1;
      console.error(`[validate-tei] FAIL ${doc.id}\n${result.stderr || result.stdout}`);
    }
  }

  db.close();
  if (failures > 0) {
    console.error(`[validate-tei] ${failures} document(s) failed validation.`);
    return 1;
  }
  console.log(`[validate-tei] All ${rows.length} document(s) validated against TEI P5.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
