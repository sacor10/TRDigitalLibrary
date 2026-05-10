import { basename } from 'node:path';

import {
  DocumentSchema,
  DocumentSectionSchema,
  type Document,
  type DocumentSection,
  type DocumentType,
} from '@tr/shared';

import {
  extractMetadata,
  extractPlainText,
  extractSections,
  type ParsedTei,
  type TeiMetadata,
} from './tei-parser.js';

const MAX_TRANSCRIPTION_CHARS = 200_000;

export interface TransformOptions {
  filename: string;
  rawXml: string;
  defaultType?: DocumentType;
  defaultSource?: string;
}

export interface TransformResult {
  document: Document;
  sections: DocumentSection[];
  warnings: string[];
}

const GENRE_TO_TYPE: Record<string, DocumentType> = {
  letter: 'letter',
  correspondence: 'letter',
  speech: 'speech',
  address: 'speech',
  diary: 'diary',
  journal: 'diary',
  article: 'article',
  essay: 'article',
  autobiography: 'autobiography',
  memoir: 'autobiography',
  manuscript: 'manuscript',
};

function inferType(metadata: TeiMetadata, fallback: DocumentType): DocumentType {
  if (metadata.genre) {
    const normalized = metadata.genre.trim().toLowerCase();
    const mapped = GENRE_TO_TYPE[normalized];
    if (mapped) return mapped;
  }
  return fallback;
}

function deriveId(metadata: TeiMetadata, filename: string): string {
  if (metadata.xmlId) return metadata.xmlId;
  return basename(filename).replace(/\.[xX][mM][lL]$/, '');
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;
  const m = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function transformToDocument(
  parsed: ParsedTei,
  options: TransformOptions,
): TransformResult {
  const warnings: string[] = [];
  const metadata = extractMetadata(parsed);
  const id = deriveId(metadata, options.filename);
  const date = normalizeDate(metadata.date);
  if (!date) {
    throw new Error(
      `Unable to determine date for ${options.filename}: ` +
        `expected <profileDesc>/<creation>/<date> with @when or YYYY[-MM[-DD]] text`,
    );
  }

  const transcription = extractPlainText(parsed).slice(0, MAX_TRANSCRIPTION_CHARS);

  const fallbackType: DocumentType = options.defaultType ?? 'letter';
  const document: Document = DocumentSchema.parse({
    id,
    title: metadata.title || basename(options.filename),
    type: inferType(metadata, fallbackType),
    date,
    recipient: metadata.recipient,
    location: null,
    author: metadata.author ?? 'Theodore Roosevelt',
    transcription,
    transcriptionUrl: null,
    transcriptionFormat: 'tei-xml',
    facsimileUrl: null,
    iiifManifestUrl: null,
    provenance: metadata.publicationStmt || null,
    source: metadata.sourceDesc || options.defaultSource || basename(options.filename),
    sourceUrl: null,
    tags: [],
    teiXml: options.rawXml,
  });

  const rawSections = extractSections(parsed, id);
  const sections: DocumentSection[] = rawSections.map((s) =>
    DocumentSectionSchema.parse({
      id: s.id,
      documentId: id,
      parentId: s.parentId,
      order: s.order,
      level: s.level,
      type: s.type,
      n: s.n,
      heading: s.heading,
      text: s.text,
      xmlFragment: s.xmlFragment,
    }),
  );

  return { document, sections, warnings };
}
