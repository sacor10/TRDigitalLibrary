import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { DocumentType } from '@tr/shared';

import {
  replaceSections,
  upsertDocument,
  type LibsqlClient,
  type ProvenanceContext,
} from '../db.js';

import { parseTei } from './tei-parser.js';
import { validateTei } from './tei-validator.js';
import { transformToDocument } from './tei-transformer.js';

export interface IngestOptions {
  recursive?: boolean;
  dryRun?: boolean;
  defaultType?: DocumentType;
  defaultSource?: string;
  editor?: string;
}

export interface IngestFileResult {
  file: string;
  status: 'ok' | 'invalid' | 'error';
  documentId?: string;
  sectionCount?: number;
  errors?: string[];
  warnings?: string[];
}

export interface IngestReport {
  scanned: number;
  valid: number;
  invalid: number;
  written: number;
  results: IngestFileResult[];
}

function listXmlFiles(folder: string, recursive: boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (recursive) walk(full);
        continue;
      }
      if (st.isFile() && /\.xml$/i.test(entry)) out.push(full);
    }
  };
  walk(folder);
  out.sort();
  return out;
}

export async function ingestTeiFolder(
  folder: string,
  db: LibsqlClient | null,
  options: IngestOptions = {},
): Promise<IngestReport> {
  const files = listXmlFiles(folder, options.recursive ?? false);
  const report: IngestReport = {
    scanned: files.length,
    valid: 0,
    invalid: 0,
    written: 0,
    results: [],
  };

  for (const file of files) {
    const rel = relative(folder, file);
    const result: IngestFileResult = { file: rel, status: 'ok' };

    let xml: string;
    try {
      xml = readFileSync(file, 'utf8');
    } catch (err) {
      result.status = 'error';
      result.errors = [err instanceof Error ? err.message : String(err)];
      report.invalid += 1;
      report.results.push(result);
      continue;
    }

    try {
      const parsed = parseTei(xml);
      const validation = validateTei(parsed);
      if (!validation.ok) {
        result.status = 'invalid';
        result.errors = validation.errors;
        result.warnings = validation.warnings;
        report.invalid += 1;
        report.results.push(result);
        continue;
      }

      const transformOpts: Parameters<typeof transformToDocument>[1] = {
        filename: file,
        rawXml: xml,
      };
      if (options.defaultType) transformOpts.defaultType = options.defaultType;
      if (options.defaultSource) transformOpts.defaultSource = options.defaultSource;
      const transformed = transformToDocument(parsed, transformOpts);

      result.documentId = transformed.document.id;
      result.sectionCount = transformed.sections.length;
      result.warnings = [...validation.warnings, ...transformed.warnings];
      report.valid += 1;

      if (!options.dryRun && db) {
        const ctx: ProvenanceContext = {
          sourceUrl: transformed.document.sourceUrl,
          fetchedAt: statSync(file).mtime.toISOString(),
          editor: options.editor ?? 'tei-ingest',
        };
        // upsertDocument and replaceSections each open their own write batch.
        // Running them sequentially is correct: per-document atomicity is
        // sufficient for re-ingest because the documents.id PK gates the row,
        // and replaceSections is itself atomic (DELETE + INSERT in one batch).
        await upsertDocument(db, transformed.document, ctx);
        await replaceSections(db, transformed.document.id, transformed.sections);
        report.written += 1;
      }
    } catch (err) {
      result.status = 'error';
      result.errors = [err instanceof Error ? err.message : String(err)];
      report.invalid += 1;
    }

    report.results.push(result);
  }

  return report;
}
