import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  extractMetadata,
  extractPlainText,
  extractSections,
  parseTei,
} from '../tei-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('parseTei', () => {
  it('parses a well-formed TEI document', () => {
    const xml = loadFixture('letter-valid.xml');
    const parsed = parseTei(xml);
    expect(parsed.root).not.toBeNull();
  });

  it('throws on malformed XML', () => {
    const xml = loadFixture('malformed.xml');
    expect(() => parseTei(xml)).toThrow(/Malformed XML/);
  });
});

describe('extractMetadata', () => {
  it('extracts title, date (@when), and recipient from a letter fixture', () => {
    const parsed = parseTei(loadFixture('letter-valid.xml'));
    const metadata = extractMetadata(parsed);

    expect(metadata.xmlId).toBe('tr-to-lodge-1898-04-26');
    expect(metadata.title).toContain('Henry Cabot Lodge');
    expect(metadata.date).toBe('1898-04-26');
    expect(metadata.recipient).toBe('Henry Cabot Lodge');
    expect(metadata.author).toBe('Theodore Roosevelt');
    expect(metadata.publicationStmt).toContain('public domain');
    expect(metadata.sourceDesc).toContain('Lodge');
  });

  it('extracts genre from textDesc/channel for a speech', () => {
    const parsed = parseTei(loadFixture('speech-valid.xml'));
    const metadata = extractMetadata(parsed);
    expect(metadata.genre).toBe('speech');
  });
});

describe('extractPlainText', () => {
  it('concatenates body text and collapses whitespace', () => {
    const parsed = parseTei(loadFixture('letter-valid.xml'));
    const text = extractPlainText(parsed);
    expect(text).toContain('Dear Cabot');
    expect(text).toContain('Rough Riders');
    expect(text).not.toMatch(/\n\s{2,}/);
  });
});

describe('extractSections', () => {
  it('preserves hierarchy: div > p (with head as heading on the div)', () => {
    const parsed = parseTei(loadFixture('letter-valid.xml'));
    const sections = extractSections(parsed, 'doc-1');

    const divs = sections.filter((s) => s.type === 'div');
    expect(divs).toHaveLength(1);
    const div = divs[0]!;
    expect(div.heading).toBe('To Henry Cabot Lodge');
    expect(div.level).toBe(0);
    expect(div.n).toBe('1');
    expect(div.xmlFragment).toContain('Rough Riders');

    const paragraphs = sections.filter((s) => s.type === 'p');
    expect(paragraphs).toHaveLength(3);
    for (const p of paragraphs) {
      expect(p.parentId).toBe(div.id);
      expect(p.level).toBe(1);
    }
    expect(paragraphs.map((p) => p.n)).toEqual(['opening', 'body', 'closing']);
  });

  it('handles nested verse: div > lg > l', () => {
    const parsed = parseTei(loadFixture('speech-valid.xml'));
    const sections = extractSections(parsed, 'doc-2');

    const divs = sections.filter((s) => s.type === 'div');
    expect(divs).toHaveLength(2);

    const lgs = sections.filter((s) => s.type === 'lg');
    expect(lgs).toHaveLength(1);
    const lg = lgs[0]!;
    expect(lg.parentId).toBe(divs[1]!.id);
    expect(lg.level).toBe(1);

    const lines = sections.filter((s) => s.type === 'l');
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l.parentId).toBe(lg.id);
      expect(l.level).toBe(2);
    }
  });

  it('orders sections in document order', () => {
    const parsed = parseTei(loadFixture('letter-valid.xml'));
    const sections = extractSections(parsed, 'doc-1');
    const orders = sections.map((s) => s.order);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
  });
});
