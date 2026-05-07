import type { Document } from '@tr/shared';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function exportFilename(doc: Document, ext: 'pdf' | 'epub' | 'xml'): string {
  const author = slugify(doc.author.split(/\s+/).slice(-1)[0] ?? 'document') || 'document';
  const date = doc.date;
  const title = slugify(doc.title) || 'untitled';
  return `${author}-${date}-${title}.${ext}`;
}
