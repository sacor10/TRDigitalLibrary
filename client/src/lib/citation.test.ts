import { describe, expect, it } from 'vitest';

import type { Document } from '@tr/shared';

import { buildCitation } from './citation';

const sample: Document = {
  id: 'sample',
  title: 'A Sample Title',
  type: 'speech',
  date: '1910-04-23',
  recipient: null,
  location: 'Paris',
  author: 'Theodore Roosevelt',
  transcription: '',
  transcriptionUrl: null,
  transcriptionFormat: 'wikisource-html',
  facsimileUrl: null,
  provenance: null,
  source: 'Wikisource',
  sourceUrl: 'https://en.wikisource.org/wiki/Sample',
  tags: [],
};

describe('buildCitation', () => {
  it('produces a Chicago citation with author, title, date, source, and URL', () => {
    const c = buildCitation(sample, 'chicago');
    expect(c).toContain('Theodore Roosevelt');
    expect(c).toContain('"A Sample Title."');
    expect(c).toContain('1910-04-23');
    expect(c).toContain('Wikisource');
    expect(c).toContain('https://en.wikisource.org/wiki/Sample');
    expect(c).toContain('Accessed');
  });

  it('produces an MLA citation', () => {
    const c = buildCitation(sample, 'mla');
    expect(c.startsWith('Theodore Roosevelt.')).toBe(true);
    expect(c).toContain('"A Sample Title."');
  });

  it('produces an APA citation with year in parens', () => {
    const c = buildCitation(sample, 'apa');
    expect(c).toContain('(1910');
    expect(c).toContain('A Sample Title');
  });

  it('omits a trailing url segment cleanly when sourceUrl is null', () => {
    const c = buildCitation({ ...sample, sourceUrl: null }, 'chicago');
    expect(c).toContain('Wikisource. Accessed');
  });
});
