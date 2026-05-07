import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseTei } from '../tei-parser.js';
import { validateTei } from '../tei-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('validateTei', () => {
  it('accepts a valid letter', () => {
    const parsed = parseTei(loadFixture('letter-valid.xml'));
    const result = validateTei(parsed);
    expect(result.ok).toBe(true);
  });

  it('accepts a valid speech', () => {
    const parsed = parseTei(loadFixture('speech-valid.xml'));
    const result = validateTei(parsed);
    expect(result.ok).toBe(true);
  });

  it('rejects a document missing <body>', () => {
    const parsed = parseTei(loadFixture('missing-body.xml'));
    const result = validateTei(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /body/i.test(e))).toBe(true);
    }
  });

  it('rejects a non-TEI root element', () => {
    const parsed = parseTei(
      `<?xml version="1.0"?><notTEI><body/></notTEI>`,
    );
    const result = validateTei(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/Root element must be <TEI>/);
    }
  });

  it('rejects missing teiHeader', () => {
    const parsed = parseTei(
      `<?xml version="1.0"?>
       <TEI xmlns="http://www.tei-c.org/ns/1.0">
         <text><body><p>hi</p></body></text>
       </TEI>`,
    );
    const result = validateTei(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => /teiHeader/.test(e))).toBe(true);
    }
  });

  it('warns when @xml:id is absent', () => {
    const parsed = parseTei(
      `<?xml version="1.0"?>
       <TEI xmlns="http://www.tei-c.org/ns/1.0">
         <teiHeader>
           <fileDesc>
             <titleStmt><title>X</title></titleStmt>
             <publicationStmt><p>x</p></publicationStmt>
             <sourceDesc><bibl>x</bibl></sourceDesc>
           </fileDesc>
           <profileDesc><creation><date when="1900-01-01">1900</date></creation></profileDesc>
         </teiHeader>
         <text><body><p>hi</p></body></text>
       </TEI>`,
    );
    const result = validateTei(parsed);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => /xml:id/.test(w))).toBe(true);
  });
});
