import type { DocumentType } from '@tr/shared';

export const TYPE_LABEL: Record<DocumentType, string> = {
  letter: 'Letter',
  speech: 'Speech',
  diary: 'Diary',
  article: 'Memoir / Article',
  autobiography: 'Autobiography',
  manuscript: 'Manuscript',
};

/** Short monogram shown on the fallback (text-only) thumbnail tile. */
export const TYPE_MONOGRAM: Record<DocumentType, string> = {
  letter: 'Lr',
  speech: 'Sp',
  diary: 'Di',
  article: 'Ar',
  autobiography: 'Au',
  manuscript: 'Ms',
};

/**
 * FTS5 snippet() returns plain text with our chosen <mark>/</mark> delimiters at
 * match boundaries. Escape everything, then re-enable only <mark> as defense in
 * depth. (Mirrors the desktop SearchResults sanitizer.)
 */
export function sanitizeSnippet(snippet: string): string {
  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  let safe = escapeHtml(snippet);
  safe = safe.replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
  return safe;
}
