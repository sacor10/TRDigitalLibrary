import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

import { createApp } from '../app.js';
import {
  openInMemoryDatabase,
  replaceSections,
  upsertDocument,
  type LibsqlClient,
} from '../db.js';
import { parseTei } from '../ingest/tei-parser.js';
import { transformToDocument } from '../ingest/tei-transformer.js';

import { cloneTestDocuments } from './fixtures/documents.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixturePath(name: string): string {
  return join(__dirname, '..', 'ingest', '__tests__', 'fixtures', name);
}

describe('Multi-format exports', () => {
  let db: LibsqlClient;
  let app: ReturnType<typeof createApp>;
  const fixtureDocs = cloneTestDocuments();
  const plainTextDoc = fixtureDocs[0]!; // man-in-the-arena, no teiXml
  let teiSourceXml: string;
  let teiDocId: string;

  beforeAll(async () => {
    db = await openInMemoryDatabase();
    for (const doc of fixtureDocs) {
      await upsertDocument(db, {
        ...doc,
        transcription: `Stub paragraph one for ${doc.title}.\n\nStub paragraph two with detail.`,
      });
    }
    const fixtureFile = fixturePath('letter-valid.xml');
    teiSourceXml = readFileSync(fixtureFile, 'utf8');
    const parsed = parseTei(teiSourceXml);
    const transformed = transformToDocument(parsed, {
      filename: fixtureFile,
      rawXml: teiSourceXml,
    });
    await upsertDocument(db, transformed.document);
    await replaceSections(db, transformed.document.id, transformed.sections);
    teiDocId = transformed.document.id;
    app = createApp(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('GET /api/documents/:id/export.pdf', () => {
    it('returns a PDF with the magic header and attachment headers', async () => {
      const res = await request(app)
        .get(`/api/documents/${plainTextDoc.id}/export.pdf`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/pdf/);
      const disposition = res.headers['content-disposition'] as string;
      expect(disposition).toMatch(/^attachment;/);
      expect(disposition).toMatch(/\.pdf"$/);
      expect(disposition).toMatch(/roosevelt-/);
      const body = res.body as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // Real PDFs end with %%EOF; size sanity
      expect(body.length).toBeGreaterThan(800);
      expect(body.toString('latin1').includes('%%EOF')).toBe(true);
    });

    it('also works for TEI-ingested documents (renders sections)', async () => {
      const res = await request(app)
        .get(`/api/documents/${teiDocId}/export.pdf`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });
  });

  describe('GET /api/documents/:id/export.epub', () => {
    it('returns a structurally valid EPUB 3 zip', async () => {
      const res = await request(app)
        .get(`/api/documents/${plainTextDoc.id}/export.epub`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/epub\+zip/);
      const body = res.body as Buffer;
      // ZIP magic
      expect(body.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');

      const zip = await JSZip.loadAsync(body);

      // mimetype must be present and exact
      const mimetype = await zip.file('mimetype')!.async('string');
      expect(mimetype).toBe('application/epub+zip');

      // container.xml points at OPF
      const containerXml = await zip.file('META-INF/container.xml')!.async('string');
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
      const container = parser.parse(containerXml) as {
        container: { rootfiles: { rootfile: { 'full-path': string; 'media-type': string } } };
      };
      expect(container.container.rootfiles.rootfile['full-path']).toBe('OEBPS/content.opf');

      // OPF parses and contains correct dc:title, dc:creator, dc:date
      const opfXml = await zip.file('OEBPS/content.opf')!.async('string');
      const opf = parser.parse(opfXml) as {
        package: {
          metadata: {
            'dc:title': string;
            'dc:creator': string;
            'dc:date': string;
            'dc:language': string;
          };
        };
      };
      expect(opf.package.metadata['dc:title']).toBe(plainTextDoc.title);
      expect(opf.package.metadata['dc:creator']).toBe(plainTextDoc.author);
      expect(opf.package.metadata['dc:date']).toBe(plainTextDoc.date);
      expect(opf.package.metadata['dc:language']).toBe('en');

      // Content xhtml is well-formed and includes the title
      const docXhtml = await zip.file('OEBPS/document.xhtml')!.async('string');
      expect(docXhtml).toContain('<?xml version="1.0"');
      expect(docXhtml).toContain(plainTextDoc.title);

      // Nav is present and marks itself as nav
      const navXhtml = await zip.file('OEBPS/nav.xhtml')!.async('string');
      expect(navXhtml).toMatch(/epub:type="toc"/);
    });

    it('includes section-rendered content for TEI-ingested docs', async () => {
      const res = await request(app)
        .get(`/api/documents/${teiDocId}/export.epub`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      const zip = await JSZip.loadAsync(res.body as Buffer);
      const docXhtml = await zip.file('OEBPS/document.xhtml')!.async('string');
      expect(docXhtml).toContain('Dear Cabot');
      expect(docXhtml).toContain('Rough Riders');
    });
  });

  describe('GET /api/documents/:id/export.xml (TEI)', () => {
    it('returns the original tei_xml byte-equal when available (passthrough)', async () => {
      const res = await request(app).get(`/api/documents/${teiDocId}/export.xml`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/tei\+xml/);
      expect(res.text).toBe(teiSourceXml);
    });

    it('synthesizes a P5-shaped TEI when the document has no tei_xml', async () => {
      const res = await request(app).get(`/api/documents/${plainTextDoc.id}/export.xml`);
      expect(res.status).toBe(200);
      const xml = res.text;
      expect(xml.startsWith('<?xml')).toBe(true);

      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
      const tree = parser.parse(xml) as {
        TEI: {
          xmlns: string;
          teiHeader: {
            fileDesc: {
              titleStmt: { title: string; author: string };
              publicationStmt: { publisher: string; date: string };
              sourceDesc: { bibl: { title: string } };
            };
          };
          text: { body: { p: string | string[] } };
        };
      };
      expect(tree.TEI.xmlns).toBe('http://www.tei-c.org/ns/1.0');
      expect(tree.TEI.teiHeader.fileDesc.titleStmt.title).toBe(plainTextDoc.title);
      expect(tree.TEI.teiHeader.fileDesc.titleStmt.author).toBe(plainTextDoc.author);
      expect(tree.TEI.teiHeader.fileDesc.publicationStmt.publisher).toBe(
        'TR Digital Library',
      );
      expect(tree.TEI.teiHeader.fileDesc.sourceDesc.bibl.title).toBe(plainTextDoc.source);
      // Body has at least one paragraph
      const paras = tree.TEI.text.body.p;
      expect(Array.isArray(paras) ? paras.length : paras.length > 0).toBeTruthy();
    });
  });

  describe('error handling', () => {
    it('404 for unknown id', async () => {
      const res = await request(app).get('/api/documents/does-not-exist/export.pdf');
      expect(res.status).toBe(404);
    });

    it('404 for unsupported extension', async () => {
      // Ensure the document exists; it's the extension that's bad.
      // Use a fixture that we know exists:
      await replaceSections(db, plainTextDoc.id, []);
      const res = await request(app).get(
        `/api/documents/${plainTextDoc.id}/export.docx`,
      );
      // Express won't match the route at all if the param regex constraint were used,
      // but with a free :ext we return 404 from the handler.
      expect([404]).toContain(res.status);
    });
  });

  describe('OpenAPI registration', () => {
    it('lists the export path in /api/openapi.json', async () => {
      const res = await request(app).get('/api/openapi.json');
      expect(res.status).toBe(200);
      const paths = res.body.paths as Record<string, unknown>;
      expect(paths['/api/documents/{id}/export.{ext}']).toBeDefined();
    });
  });
});
