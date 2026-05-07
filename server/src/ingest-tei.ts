import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { DocumentTypeSchema, type DocumentType } from '@tr/shared';

import { openDatabase } from './db.js';
import { ingestTeiFolder, type IngestReport } from './ingest/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CliOptions {
  folder: string;
  dryRun: boolean;
  recursive: boolean;
  dbPath: string;
  defaultType: DocumentType;
  defaultSource?: string;
  editor?: string;
}

function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      recursive: { type: 'boolean', short: 'r', default: false },
      db: { type: 'string' },
      'default-type': { type: 'string', default: 'letter' },
      'default-source': { type: 'string' },
      editor: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const positional = positionals[0];
  if (values.help || !positional) {
    printUsage();
    process.exit(values.help ? 0 : 1);
  }

  const folder = resolve(positional);
  try {
    if (!statSync(folder).isDirectory()) {
      throw new Error(`${folder} is not a directory`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  const defaultTypeParse = DocumentTypeSchema.safeParse(values['default-type']);
  if (!defaultTypeParse.success) {
    console.error(
      `Error: --default-type must be one of ${DocumentTypeSchema.options.join(', ')}`,
    );
    process.exit(1);
  }

  const defaultDbPath = join(__dirname, '..', '..', 'data', 'library.db');
  const opts: CliOptions = {
    folder,
    dryRun: Boolean(values['dry-run']),
    recursive: Boolean(values.recursive),
    dbPath: values.db ? resolve(values.db) : defaultDbPath,
    defaultType: defaultTypeParse.data,
  };
  if (values['default-source']) opts.defaultSource = values['default-source'];
  if (values.editor) opts.editor = values.editor;
  return opts;
}

function printUsage(): void {
  console.log(`Usage: npm run ingest-tei -- <folder> [options]

Validates and ingests TEI/XML documents from a folder into the digital library.

Options:
  --dry-run             Parse and validate only; do not write to the database
  -r, --recursive       Recurse into subdirectories
  --db <path>           Database path (default: data/library.db)
  --default-type <t>    Default document type when not derivable from TEI
                        (one of: letter, speech, diary, article, autobiography)
  --default-source <s>  Default source citation when <sourceDesc> is empty
  --editor <name>       Editor identity recorded in per-field provenance
                        (default: 'tei-ingest')
  -h, --help            Show this help
`);
}

function printReport(report: IngestReport, dryRun: boolean): void {
  console.log(`\nTEI ingest report${dryRun ? ' (dry run)' : ''}`);
  console.log(`  files scanned:    ${report.scanned}`);
  console.log(`  valid:            ${report.valid}`);
  console.log(`  invalid:          ${report.invalid}`);
  if (!dryRun) console.log(`  inserted/updated: ${report.written}`);
  console.log('');

  for (const r of report.results) {
    if (r.status === 'ok') {
      const note = r.sectionCount != null ? ` (${r.sectionCount} sections)` : '';
      console.log(`  ok       ${r.file} -> ${r.documentId}${note}`);
      if (r.warnings && r.warnings.length > 0) {
        for (const w of r.warnings) console.log(`           warn: ${w}`);
      }
    } else {
      console.log(`  ${r.status.padEnd(8)} ${r.file}`);
      for (const e of r.errors ?? []) console.log(`           error: ${e}`);
    }
  }
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));

  let db = null;
  if (!opts.dryRun) {
    mkdirSync(dirname(opts.dbPath), { recursive: true });
    db = openDatabase(opts.dbPath);
  }

  try {
    const ingestOpts: Parameters<typeof ingestTeiFolder>[2] = {
      dryRun: opts.dryRun,
      recursive: opts.recursive,
      defaultType: opts.defaultType,
    };
    if (opts.defaultSource) ingestOpts.defaultSource = opts.defaultSource;
    if (opts.editor) ingestOpts.editor = opts.editor;
    const report = ingestTeiFolder(opts.folder, db, ingestOpts);

    printReport(report, opts.dryRun);
    process.exit(report.invalid > 0 ? 1 : 0);
  } finally {
    db?.close();
  }
}

await main();
