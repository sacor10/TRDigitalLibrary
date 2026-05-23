import type { Document } from '@tr/shared';

export type CitationStyle = 'chicago' | 'mla' | 'apa' | 'bibtex' | 'ris';

function year(date: string): string {
  return date.slice(0, 4);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function citationKey(doc: Document): string {
  const author = doc.author.split(/\s+/).filter(Boolean).at(-1) ?? 'Roosevelt';
  const slug = doc.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');
  return `${author}${year(doc.date)}${slug ? `-${slug}` : ''}`;
}

function bibtexEscape(value: string): string {
  return value.replace(/[{}\\]/g, (ch) => `\\${ch}`);
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
    case 'bibtex':
      return [
        `@misc{${citationKey(doc)},`,
        `  author = {${bibtexEscape(author)}},`,
        `  title = {${bibtexEscape(title)}},`,
        `  year = {${dateYear}},`,
        `  date = {${fullDate}},`,
        `  howpublished = {${bibtexEscape(source)}},`,
        ...(url ? [`  url = {${bibtexEscape(url)}},`] : []),
        `  note = {Accessed ${accessed}}`,
        `}`,
      ].join('\n');
    case 'ris':
      return [
        'TY  - MANSCPT',
        `AU  - ${author}`,
        `TI  - ${title}`,
        `PY  - ${dateYear}`,
        `DA  - ${fullDate}`,
        `PB  - ${source}`,
        ...(url ? [`UR  - ${url}`] : []),
        `Y2  - ${accessed}`,
        'ER  -',
      ].join('\n');
    default:
      return '';
  }
}

export function citationDownloadHref(doc: Document, style: 'bibtex' | 'ris'): string {
  return `data:text/plain;charset=utf-8,${encodeURIComponent(buildCitation(doc, style))}`;
}
