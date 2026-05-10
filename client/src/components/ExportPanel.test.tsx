import { render, screen } from '@testing-library/react';
import type { Document } from '@tr/shared';
import { describe, expect, it } from 'vitest';


import { ExportPanel } from './ExportPanel';

const sample: Document = {
  id: 'man-in-the-arena',
  title: 'Citizenship in a Republic',
  type: 'speech',
  date: '1910-04-23',
  recipient: null,
  location: 'Paris',
  author: 'Theodore Roosevelt',
  transcription: '',
  transcriptionUrl: null,
  transcriptionFormat: 'wikisource-html',
  facsimileUrl: null,
  iiifManifestUrl: null,
  provenance: null,
  source: 'Wikisource',
  sourceUrl: 'https://en.wikisource.org/wiki/Sample',
  tags: [],
  mentions: [],
  teiXml: null,
};

describe('ExportPanel', () => {
  it('renders one download anchor per format with the correct hrefs', () => {
    render(<ExportPanel document={sample} />);
    const pdf = screen.getByRole('link', { name: /Download .* PDF/i });
    const epub = screen.getByRole('link', { name: /Download .* EPUB/i });
    const tei = screen.getByRole('link', { name: /Download .* TEI XML/i });

    expect(pdf.getAttribute('href')).toBe('/api/documents/man-in-the-arena/export.pdf');
    expect(pdf.hasAttribute('download')).toBe(true);
    expect(epub.getAttribute('href')).toBe('/api/documents/man-in-the-arena/export.epub');
    expect(tei.getAttribute('href')).toBe('/api/documents/man-in-the-arena/export.xml');
  });

  it('encodes ids that contain reserved characters', () => {
    render(<ExportPanel document={{ ...sample, id: 'a/b c' }} />);
    const pdf = screen.getByRole('link', { name: /PDF/i });
    expect(pdf.getAttribute('href')).toBe('/api/documents/a%2Fb%20c/export.pdf');
  });
});
