import type { Document, DocumentSection } from '@tr/shared';
import PDFDocument from 'pdfkit';


const PAGE_MARGIN = 72;
const BODY_FONT = 'Times-Roman';
const BODY_ITALIC = 'Times-Italic';
const BODY_BOLD = 'Times-Bold';
const SANS_REGULAR = 'Helvetica';

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

function renderHeader(pdf: PDFKit.PDFDocument, doc: Document): void {
  pdf.font(SANS_REGULAR).fontSize(9).fillColor('#666');
  pdf.text(`TR Digital Library — ${doc.source}`, { align: 'left' });
  pdf.moveDown(0.5);

  pdf.font(BODY_BOLD).fontSize(22).fillColor('#1a1612');
  pdf.text(doc.title, { align: 'left' });
  pdf.moveDown(0.25);

  pdf.font(BODY_ITALIC).fontSize(11).fillColor('#3a3128');
  pdf.text(attribution(doc), { align: 'left' });

  pdf.moveDown(0.75);
  pdf.strokeColor('#3a3128').lineWidth(0.5);
  pdf
    .moveTo(pdf.x, pdf.y)
    .lineTo(pdf.page.width - PAGE_MARGIN, pdf.y)
    .stroke();
  pdf.moveDown(0.75);
  pdf.fillColor('#1a1612');
}

function renderSection(
  pdf: PDFKit.PDFDocument,
  section: DocumentSection,
): void {
  switch (section.type) {
    case 'head': {
      const size = Math.max(12, 18 - section.level * 2);
      pdf.font(BODY_BOLD).fontSize(size);
      pdf.moveDown(0.5);
      pdf.text(section.heading ?? section.text);
      pdf.moveDown(0.25);
      return;
    }
    case 'l': {
      pdf.font(BODY_FONT).fontSize(11);
      pdf.text(section.text, { indent: 18, lineGap: 2 });
      return;
    }
    case 'lg': {
      if (section.heading) {
        pdf.font(BODY_ITALIC).fontSize(11);
        pdf.text(section.heading);
      }
      pdf.moveDown(0.25);
      return;
    }
    case 'quote': {
      pdf.font(BODY_ITALIC).fontSize(11);
      pdf.text(section.text, { indent: 24, lineGap: 2 });
      pdf.moveDown(0.25);
      return;
    }
    case 'list': {
      if (section.heading) {
        pdf.font(BODY_BOLD).fontSize(11);
        pdf.text(section.heading);
        pdf.moveDown(0.15);
      }
      return;
    }
    case 'item': {
      pdf.font(BODY_FONT).fontSize(11);
      pdf.text(`• ${section.text}`, { indent: 12, lineGap: 1.5 });
      return;
    }
    case 'note': {
      pdf.font(BODY_ITALIC).fontSize(9).fillColor('#555');
      pdf.text(section.text, { indent: 18, lineGap: 1 });
      pdf.fillColor('#1a1612');
      pdf.moveDown(0.25);
      return;
    }
    case 'div': {
      if (section.heading) {
        pdf.font(BODY_BOLD).fontSize(13);
        pdf.moveDown(0.5);
        pdf.text(section.heading);
        pdf.moveDown(0.25);
      }
      return;
    }
    case 'p':
    default: {
      pdf.font(BODY_FONT).fontSize(11);
      pdf.text(section.text, { align: 'justify', lineGap: 2 });
      pdf.moveDown(0.4);
      return;
    }
  }
}

function renderBody(
  pdf: PDFKit.PDFDocument,
  doc: Document,
  sections: DocumentSection[],
): void {
  if (sections.length > 0) {
    for (const section of sections) {
      if (!section.text && !section.heading) continue;
      renderSection(pdf, section);
    }
    return;
  }

  pdf.font(BODY_FONT).fontSize(11);
  const paragraphs = paragraphsFrom(doc.transcription);
  if (paragraphs.length === 0) {
    pdf.font(BODY_ITALIC).fontSize(11).fillColor('#666');
    pdf.text(
      'No transcription available. Visit the source URL below to view the original document.',
      { align: 'left' },
    );
    pdf.fillColor('#1a1612');
    return;
  }
  for (const para of paragraphs) {
    pdf.text(para, { align: 'justify', lineGap: 2 });
    pdf.moveDown(0.4);
  }
}

function renderFooter(pdf: PDFKit.PDFDocument, doc: Document): void {
  pdf.moveDown(1);
  pdf.strokeColor('#3a3128').lineWidth(0.25);
  pdf
    .moveTo(pdf.x, pdf.y)
    .lineTo(pdf.page.width - PAGE_MARGIN, pdf.y)
    .stroke();
  pdf.moveDown(0.5);

  pdf.font(SANS_REGULAR).fontSize(9).fillColor('#444');
  pdf.text(`Source: ${doc.source}`, { continued: false });
  if (doc.sourceUrl) {
    pdf.fillColor('#7a4f30').text(doc.sourceUrl, {
      link: doc.sourceUrl,
      underline: true,
    });
    pdf.fillColor('#444');
  }
  pdf.text(`Accessed ${new Date().toISOString().slice(0, 10)} via TR Digital Library.`);
  pdf.fillColor('#1a1612');
}

export function generatePdf(doc: Document, sections: DocumentSection[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'LETTER',
      margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
      info: {
        Title: doc.title,
        Author: doc.author,
        Subject: doc.type,
        Keywords: doc.tags.join(', '),
        CreationDate: new Date(),
      },
    });

    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    try {
      renderHeader(pdf, doc);
      renderBody(pdf, doc, sections);
      renderFooter(pdf, doc);
      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}
