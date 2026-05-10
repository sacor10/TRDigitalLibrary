import type { Document, DocumentSection } from '@tr/shared';
import JSZip from 'jszip';


const EPUB_CSS = `body { font-family: Georgia, "Times New Roman", serif; line-height: 1.6; margin: 1em; color: #1a1612; }
h1 { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 1.6em; margin: 0 0 0.25em; }
h2 { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 1.25em; margin: 1em 0 0.5em; }
.attribution { font-style: italic; color: #3a3128; margin-bottom: 1.5em; border-bottom: 1px solid #ccc; padding-bottom: 0.5em; }
p { text-align: justify; margin: 0.6em 0; }
blockquote { margin: 0.6em 1.5em; font-style: italic; color: #3a3128; }
.verse { padding-left: 1.5em; }
.note { font-size: 0.9em; color: #555; padding-left: 1em; }
ul { padding-left: 1.5em; }
.colophon { margin-top: 2em; padding-top: 1em; border-top: 1px solid #ccc; font-size: 0.9em; color: #555; }
.colophon a { color: #7a4f30; }
`;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function paragraphsFrom(transcription: string): string[] {
  const cleaned = transcription.replace(/\r\n?/g, '\n');
  const paras = cleaned
    .split(/\n{2,}/)
    .map((p) => stripTags(p))
    .filter((p) => p.length > 0);
  if (paras.length > 0) return paras;
  const single = stripTags(cleaned);
  return single.length > 0 ? [single] : [];
}

function attribution(doc: Document): string {
  const parts: string[] = [doc.author];
  if (doc.recipient) parts.push(`to ${doc.recipient}`);
  if (doc.location) parts.push(doc.location);
  parts.push(doc.date);
  return parts.join(' · ');
}

function renderSectionXhtml(section: DocumentSection): string {
  const text = escapeXml(section.text);
  const heading = section.heading ? escapeXml(section.heading) : '';
  switch (section.type) {
    case 'head': {
      const level = Math.min(6, Math.max(2, section.level + 1));
      return `<h${level}>${heading || text}</h${level}>`;
    }
    case 'l':
      return `<p class="verse">${text}</p>`;
    case 'lg':
      return heading ? `<p class="verse"><em>${heading}</em></p>` : '';
    case 'quote':
      return `<blockquote>${text}</blockquote>`;
    case 'list':
      return heading ? `<p><strong>${heading}</strong></p>` : '';
    case 'item':
      return `<ul><li>${text}</li></ul>`;
    case 'note':
      return `<p class="note">${text}</p>`;
    case 'div':
      return heading ? `<h2>${heading}</h2>` : '';
    case 'p':
    default:
      return `<p>${text}</p>`;
  }
}

function renderBodyXhtml(doc: Document, sections: DocumentSection[]): string {
  if (sections.length > 0) {
    return sections
      .filter((s) => s.text || s.heading)
      .map(renderSectionXhtml)
      .filter((s) => s.length > 0)
      .join('\n  ');
  }
  const paras = paragraphsFrom(doc.transcription);
  if (paras.length === 0) {
    return '<p><em>No transcription available. Visit the source URL below.</em></p>';
  }
  return paras.map((p) => `<p>${escapeXml(p)}</p>`).join('\n  ');
}

function buildContentXhtml(doc: Document, sections: DocumentSection[]): string {
  const colophonLink = doc.sourceUrl
    ? `<p>Source: <a href="${escapeXml(doc.sourceUrl)}">${escapeXml(doc.source)}</a></p>`
    : `<p>Source: ${escapeXml(doc.source)}</p>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">
<head>
  <title>${escapeXml(doc.title)}</title>
  <meta charset="UTF-8" />
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <h1>${escapeXml(doc.title)}</h1>
  <p class="attribution">${escapeXml(attribution(doc))}</p>
  ${renderBodyXhtml(doc, sections)}
  <div class="colophon">
    ${colophonLink}
    <p>Accessed ${new Date().toISOString().slice(0, 10)} via TR Digital Library.</p>
  </div>
</body>
</html>
`;
}

function buildNavXhtml(doc: Document): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
  <title>${escapeXml(doc.title)}</title>
  <meta charset="UTF-8" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of contents</h1>
    <ol>
      <li><a href="document.xhtml">${escapeXml(doc.title)}</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

function buildContentOpf(doc: Document): string {
  const bookId = `urn:tr-digital-library:${escapeXml(doc.id)}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const tags = doc.tags
    .map((t) => `    <dc:subject>${escapeXml(t)}</dc:subject>`)
    .join('\n');
  const sourceMeta = doc.sourceUrl
    ? `    <dc:source>${escapeXml(doc.sourceUrl)}</dc:source>`
    : `    <dc:source>${escapeXml(doc.source)}</dc:source>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${escapeXml(doc.title)}</dc:title>
    <dc:creator>${escapeXml(doc.author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:date>${escapeXml(doc.date)}</dc:date>
    <dc:publisher>TR Digital Library</dc:publisher>
    <dc:rights>CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/</dc:rights>
${sourceMeta}
${tags}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="doc" href="document.xhtml" media-type="application/xhtml+xml" />
    <item id="css" href="style.css" media-type="text/css" />
  </manifest>
  <spine>
    <itemref idref="doc" />
  </spine>
</package>
`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

export async function generateEpub(
  doc: Document,
  sections: DocumentSection[],
): Promise<Buffer> {
  const zip = new JSZip();

  // The EPUB spec requires `mimetype` to be the FIRST entry, stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', {
    compression: 'STORE',
  });
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('OEBPS/content.opf', buildContentOpf(doc));
  zip.file('OEBPS/nav.xhtml', buildNavXhtml(doc));
  zip.file('OEBPS/document.xhtml', buildContentXhtml(doc, sections));
  zip.file('OEBPS/style.css', EPUB_CSS);

  return zip.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}
