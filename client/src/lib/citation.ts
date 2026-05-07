import type { Document } from '@tr/shared';

export type CitationStyle = 'chicago' | 'mla' | 'apa';

function year(date: string): string {
  return date.slice(0, 4);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildCitation(doc: Document, style: CitationStyle): string {
  const { author, title, source, date: fullDate } = doc;
  const dateYear = year(fullDate);
  const url = doc.sourceUrl ?? '';
  const accessed = todayISO();

  switch (style) {
    case 'chicago':
      return `${author}. "${title}." ${fullDate}. ${source}. ${url ? `${url}. ` : ''}Accessed ${accessed}.`;
    case 'mla':
      return `${author}. "${title}." ${source}, ${fullDate}, ${url}. Accessed ${accessed}.`;
    case 'apa':
      return `${author}. (${dateYear}, ${fullDate}). ${title}. ${source}. ${url}`;
    default:
      return '';
  }
}
