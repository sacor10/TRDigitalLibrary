import type { Document, DocumentSection } from '@tr/shared';

import { generateEpub } from './epub.js';
import { generatePdf } from './pdf.js';
import { exportFilename } from './slug.js';
import { generateTei } from './tei.js';

export type ExportFormat = 'pdf' | 'epub' | 'tei';

export interface ExportArtifact {
  body: Buffer;
  contentType: string;
  filename: string;
}

const EXT_BY_FORMAT: Record<ExportFormat, 'pdf' | 'epub' | 'xml'> = {
  pdf: 'pdf',
  epub: 'epub',
  tei: 'xml',
};

const CONTENT_TYPE_BY_FORMAT: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  tei: 'application/tei+xml; charset=utf-8',
};

export async function generateExport(
  doc: Document,
  sections: DocumentSection[],
  format: ExportFormat,
): Promise<ExportArtifact> {
  const filename = exportFilename(doc, EXT_BY_FORMAT[format]);
  const contentType = CONTENT_TYPE_BY_FORMAT[format];
  switch (format) {
    case 'pdf':
      return { body: await generatePdf(doc, sections), contentType, filename };
    case 'epub':
      return { body: await generateEpub(doc, sections), contentType, filename };
    case 'tei':
      return { body: generateTei(doc), contentType, filename };
  }
}

export const FORMAT_BY_EXT: Record<string, ExportFormat> = {
  pdf: 'pdf',
  epub: 'epub',
  xml: 'tei',
};
