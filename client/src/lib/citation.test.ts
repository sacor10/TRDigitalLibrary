import type { Document } from '@tr/shared';
import { describe, expect, it } from 'vitest';

import { buildCitation, citationKey } from './citation';

const doc: Document = {
  id: 'doc-1',
  title: 'A {Strenuous} Life',
  type: 'speech',
  date: '1910-04-23',
  recipient: null,
  location: null,
  author: 'Theodore Roosevelt',
  transcription: '',
  transcriptionUrl: null,
  transcriptionFormat: 'plain-text',
  facsimileUrl: null,
  iiifManifestUrl: null,
  provenance: null,
  source: 'TR Digital Library',
  sourceUrl: 'https://example.org/doc-1',
  tags: [],
  mentions: [],
  teiXml: null,
};

describe('citation helpers', () => {
  it('builds a stable citation key from author, year, and title', () => {
    expect(citationKey(doc)).toBe('Roosevelt1910-a-strenuous-life');
  });

  it('escapes BibTeX-sensitive title characters', () => {
    const citation = buildCitation(doc, 'bibtex');
    expect(citation).toContain('@misc{Roosevelt1910-a-strenuous-life,');
    expect(citation).toContain('title = {A \\{Strenuous\\} Life}');
  });

  it('omits empty RIS URL fields', () => {
    const citation = buildCitation({ ...doc, sourceUrl: null }, 'ris');
    expect(citation).toContain('TY  - MANSCPT');
    expect(citation).not.toContain('UR  -');
  });
});

