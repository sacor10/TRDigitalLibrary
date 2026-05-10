import type { SearchResult } from '@tr/shared';
import { Link } from 'react-router-dom';


interface SearchResultsProps {
  results: SearchResult[];
}

const ALLOWED_HTML = /^[\s\S]*$/;

function sanitizeSnippet(snippet: string): string {
  // FTS5 snippet() returns plain text with our chosen <mark>/</mark> delimiters
  // inserted at match boundaries. Strip any other tags as a defense-in-depth
  // measure and keep only mark.
  if (!ALLOWED_HTML.test(snippet)) return '';
  const escapeHtml = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // 1. Escape everything.
  let safe = escapeHtml(snippet);
  // 2. Re-enable just <mark> and </mark>.
  safe = safe.replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
  return safe;
}

export function SearchResults({ results }: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <p className="py-8 text-ink-700 dark:text-parchment-100">
        No matches. Try a different query or remove a filter.
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {results.map(({ document, snippet }) => (
        <li key={document.id} className="card hover:shadow-md transition-shadow">
          <Link to={`/documents/${document.id}`} className="block">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-lg leading-tight">{document.title}</h3>
                <p className="mt-1 text-sm text-ink-700 dark:text-parchment-100">
                  {document.date} &middot; {document.type}
                  {document.recipient && <> &middot; To {document.recipient}</>}
                </p>
              </div>
            </div>
            {snippet && (
              <p
                className="mt-3 text-sm leading-relaxed text-ink-800 dark:text-parchment-100"
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(snippet) }}
              />
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
