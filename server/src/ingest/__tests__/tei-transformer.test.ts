import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DocumentSchema, DocumentSectionSchema } from '@tr/shared';
import { describe, expect, it } from 'vitest';


import { parseTei } from '../tei-parser.js';
import { transformToDocument } from '../tei-transformer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

function loadFixture(name: string): { xml: string; path: string } {
  const path = join(fixturesDir, name);
  return { xml: readFileSync(path, 'utf8'), path };
}

describe('transformToDocument', () => {
  it('produces a Zod-valid Document and section list for a letter', () => {
    const { xml, path } = loadFixture('letter-valid.xml');
    const parsed = parseTei(xml);
    const { document, sections } = transformToDocument(parsed, {
      filename: path,
      rawXml: xml,
    });

    expect(() => DocumentSchema.parse(document)).not.toThrow();
    for (const s of sections) {
      expect(() => DocumentSectionSchema.parse(s)).not.toThrow();
    }

    expect(document.id).toBe('tr-to-lodge-1898-04-26');
    expect(document.type).toBe('letter');
    expect(document.date).toBe('1898-04-26');
    expect(document.recipient).toBe('Henry Cabot Lodge');
    expect(document.transcriptionFormat).toBe('tei-xml');
    expect(document.teiXml).toBe(xml);
    expect(document.transcription).toContain('Rough Riders');
  });

  it('infers type=speech from textDesc/channel', () => {
    const { xml, path } = loadFixture('speech-valid.xml');
    const parsed = parseTei(xml);
    const { document } = transformToDocument(parsed, {
      filename: path,
      rawXml: xml,
    });
    expect(document.type).toBe('speech');
  });

  it('falls back to filename basename when @xml:id is missing', () => {
    const xml = `<?xml version="1.0"?>
       <TEI xmlns="http://www.tei-c.org/ns/1.0">
         <teiHeader>
           <fileDesc>
             <titleStmt><title>Untitled</title></titleStmt>
             <publicationStmt><p>x</p></publicationStmt>
             <sourceDesc><bibl>x</bibl></sourceDesc>
           </fileDesc>
           <profileDesc><creation><date when="1905-06-01">June 1905</date></creation></profileDesc>
         </teiHeader>
         <text><body><p>hello</p></body></text>
       </TEI>`;
    const parsed = parseTei(xml);
    const { document } = transformToDocument(parsed, {
      filename: '/tmp/some-letter.xml',
      rawXml: xml,
    });
    expect(document.id).toBe('some-letter');
  });

  it('clamps pre-1877 TEI dates to the earliest Roosevelt publication date', () => {
    const xml = `<?xml version="1.0"?>
       <TEI xmlns="http://www.tei-c.org/ns/1.0" xml:id="range-record">
         <teiHeader>
           <fileDesc>
             <titleStmt><title>Collection range record</title></titleStmt>
             <publicationStmt><p>x</p></publicationStmt>
             <sourceDesc><bibl>x</bibl></sourceDesc>
           </fileDesc>
           <profileDesc><creation><date when="1759-08-01">1759-1898</date></creation></profileDesc>
         </teiHeader>
         <text><body><p>hello</p></body></text>
       </TEI>`;
    const parsed = parseTei(xml);
    const { document } = transformToDocument(parsed, {
      filename: '/tmp/range-record.xml',
      rawXml: xml,
    });
    expect(document.date).toBe('1877-01-01');
  });

  it('throws when the date cannot be derived', () => {
    const xml = `<?xml version="1.0"?>
       <TEI xmlns="http://www.tei-c.org/ns/1.0" xml:id="undated">
         <teiHeader>
           <fileDesc>
             <titleStmt><title>Undated</title></titleStmt>
             <publicationStmt><p>x</p></publicationStmt>
             <sourceDesc><bibl>x</bibl></sourceDesc>
           </fileDesc>
         </teiHeader>
         <text><body><p>hello</p></body></text>
       </TEI>`;
    const parsed = parseTei(xml);
    expect(() =>
      transformToDocument(parsed, { filename: '/tmp/undated.xml', rawXml: xml }),
    ).toThrow(/date/i);
  });
});
