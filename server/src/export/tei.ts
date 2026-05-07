import type { Document } from '@tr/shared';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';
const TEI_NS = 'http://www.tei-c.org/ns/1.0';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function paragraphsFrom(transcription: string): string[] {
  const stripped = transcription
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n');
  const paras = stripped
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  return paras.length > 0 ? paras : [stripped.replace(/\s+/g, ' ').trim()].filter((p) => p.length > 0);
}

function synthesizeTei(doc: Document): string {
  const title = escapeXml(doc.title);
  const author = escapeXml(doc.author);
  const sourceLabel = escapeXml(doc.source);
  const sourceUrl = doc.sourceUrl ? escapeXml(doc.sourceUrl) : null;
  const date = doc.date;
  const provenance = doc.provenance ? escapeXml(doc.provenance) : null;

  const sourceBibl = sourceUrl
    ? `<bibl><title>${sourceLabel}</title> <ref target="${sourceUrl}">${sourceUrl}</ref></bibl>`
    : `<bibl><title>${sourceLabel}</title></bibl>`;

  const provenanceNote = provenance ? `<note type="provenance">${provenance}</note>` : '';

  const paragraphs = paragraphsFrom(doc.transcription)
    .map((p) => `      <p>${escapeXml(p)}</p>`)
    .join('\n');

  return [
    XML_DECL,
    `<TEI xmlns="${TEI_NS}">`,
    '  <teiHeader>',
    '    <fileDesc>',
    '      <titleStmt>',
    `        <title>${title}</title>`,
    `        <author>${author}</author>`,
    '      </titleStmt>',
    '      <publicationStmt>',
    '        <publisher>TR Digital Library</publisher>',
    '        <availability>',
    '          <licence target="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</licence>',
    '        </availability>',
    `        <date when="${date}">${date}</date>`,
    '      </publicationStmt>',
    '      <sourceDesc>',
    `        ${sourceBibl}`,
    `        ${provenanceNote}`.replace(/^\s+$/, '').replace(/\n+/g, '\n'),
    '      </sourceDesc>',
    '    </fileDesc>',
    '  </teiHeader>',
    '  <text>',
    '    <body>',
    paragraphs.length > 0 ? paragraphs : '      <p/>',
    '    </body>',
    '  </text>',
    '</TEI>',
    '',
  ]
    .filter((line) => line !== '        ')
    .join('\n');
}

export function generateTei(doc: Document): Buffer {
  const xml = doc.teiXml && doc.teiXml.trim().length > 0 ? doc.teiXml : synthesizeTei(doc);
  return Buffer.from(xml, 'utf8');
}
