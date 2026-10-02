import type { SearchResult } from '@tr/shared';
import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';

import { SearchResultPreview } from './SearchResultPreview';

interface SearchResultsProps {
  results: SearchResult[];
  searchQuery?: string;
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

export function SearchResults({ results, searchQuery = '' }: SearchResultsProps) {
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  if (results.length === 0) {
    return (
      <p className="py-8 text-ink-700 dark:text-parchment-100">
        No matches. Try a different query or remove a filter.
      </p>
    );
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLAnchorElement | HTMLElement>(
        'a[href], [data-card-toggle="true"]',
      ),
    );
    const active = document.activeElement;
    const currentIndex = focusable.findIndex((el) => el === active);
    const nextIndex =
      event.key === 'ArrowDown'
        ? Math.min((currentIndex < 0 ? 0 : currentIndex) + 1, focusable.length - 1)
        : Math.max((currentIndex < 0 ? focusable.length : currentIndex) - 1, 0);
    (focusable[nextIndex] as HTMLElement)?.focus();
    event.preventDefault();
  };

  const toggleExpand = (docId: string) => {
    setExpandedDocId((current) => (current === docId ? null : docId));
  };

  const buildDocUrl = (docId: string) => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    const qs = params.toString();
    return `/documents/${docId}${qs ? `?${qs}` : ''}`;
  };

  return (
    <ul className="grid gap-3" onKeyDown={handleKeyDown}>
      {results.map(({ document, snippet }) => {
        const isExpanded = expandedDocId === document.id;
        return (
          <li
            key={document.id}
            className={`card cursor-pointer transition-shadow hover:shadow-md ${
              isExpanded ? 'ring-1 ring-accent-500/50' : ''
            }`}
            onClick={() => toggleExpand(document.id)}
            role="button"
            tabIndex={0}
            data-card-toggle="true"
            aria-expanded={isExpanded}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                if (e.target === e.currentTarget) {
                  e.preventDefault();
                  toggleExpand(document.id);
                }
              }
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-lg leading-tight hover:text-accent-600 transition-colors">
                  <Link
                    to={buildDocUrl(document.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="hover:underline focus:outline-none"
                  >
                    {document.title}
                  </Link>
                </h3>
                <p className="mt-1 text-sm text-ink-700 dark:text-parchment-100">
                  {document.date} &middot; {document.type}
                  {document.recipient && <> &middot; To {document.recipient}</>}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-accent-600 dark:text-accent-400 font-medium select-none">
                  {isExpanded ? 'Hide preview ▲' : 'Quick preview ▼'}
                </span>
              </div>
            </div>
            {snippet && (
              <p
                className="mt-3 text-sm leading-relaxed text-ink-800 dark:text-parchment-100"
                dangerouslySetInnerHTML={{ __html: sanitizeSnippet(snippet) }}
              />
            )}
            {isExpanded && (
              <SearchResultPreview
                documentId={document.id}
                searchQuery={searchQuery}
                snippet={snippet}
                initialDocument={document}
                onClose={() => setExpandedDocId(null)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
