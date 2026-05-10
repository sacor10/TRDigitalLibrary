/**
 * Validate every document's EPUB export with epubcheck.
 *
 * Usage: npm run validate-epub -w server
 *
 * Requires `epubcheck` on PATH (or EPUBCHECK_JAR pointing at epubcheck.jar +
 * `java` on PATH). Install via Homebrew (`brew install epubcheck`) or download
 * the JAR from https://github.com/w3c/epubcheck/releases.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase, getSectionsByDocumentId, rowToDocument, type DocumentRow } from '../src/db.js';
import { generateExport } from '../src/export/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Runner {
  cmd: string;
  args: (file: string) => string[];
}

function detectRunner(): Runner | null {
  const probeBin = spawnSync('epubcheck', ['--version'], { encoding: 'utf8' });
  if (!probeBin.error && probeBin.status === 0) {
    return { cmd: 'epubcheck', args: (file) => [file] };
  }
  const jar = process.env.EPUBCHECK_JAR;
  if (jar) {
    const probeJava = spawnSync('java', ['-version'], { encoding: 'utf8' });
    if (probeJava.error || probeJava.status !== 0) {
      console.error('[validate-epub] EPUBCHECK_JAR set but `java` not on PATH.');
      return null;
    }
    return { cmd: 'java', args: (file) => ['-jar', jar, file] };
  }
  console.error(
    '[validate-epub] `epubcheck` not on PATH and EPUBCHECK_JAR not set. ' +
      'Install via `brew install epubcheck` or download the JAR from ' +
      'https://github.com/w3c/epubcheck/releases and set EPUBCHECK_JAR.',
  );
  return null;
}

async function main(): Promise<number> {
  const runner = detectRunner();
  if (!runner) return 2;

  const dbPath = process.env.DATABASE_URL ?? join(__dirname, '..', '..', 'data', 'library.db');
  if (!existsSync(dbPath)) {
    console.error(`[validate-epub] Database not found at ${dbPath}. Run \`npm run ingest-loc -- --limit 25\` first.`);
    return 2;
  }
  const db = openDatabase(dbPath);
  const rows = db.prepare('SELECT * FROM documents ORDER BY id').all() as DocumentRow[];

  let failures = 0;
  const tmp = tmpdir();
  for (const row of rows) {
    const doc = rowToDocument(row);
    const sections = getSectionsByDocumentId(db, doc.id);
    const artifact = await generateExport(doc, sections, 'epub');
    const file = join(tmp, `${doc.id}.epub`);
    writeFileSync(file, artifact.body);
    const result = spawnSync(runner.cmd, runner.args(file), { encoding: 'utf8' });
    if (result.status === 0) {
      console.log(`[validate-epub] OK   ${doc.id}`);
    } else {
      failures += 1;
      console.error(
        `[validate-epub] FAIL ${doc.id}\n${result.stdout}\n${result.stderr}`,
      );
    }
  }

  db.close();
  if (failures > 0) {
    console.error(`[validate-epub] ${failures} document(s) failed validation.`);
    return 1;
  }
  console.log(`[validate-epub] All ${rows.length} document(s) validated by epubcheck.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
