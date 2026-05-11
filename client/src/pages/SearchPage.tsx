// Lazy-loaded via "Load more" (chosen for accessibility over IntersectionObserver).
// `q` input is debounced inside <SearchBar> (250 ms) so this page doesn't fetch on every keystroke.
import { DocumentTypeSchema, type DocumentType, type SearchResult } from '@tr/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { searchDocuments } from '../api/client';
import { LoadMore } from '../components/LoadMore';
import { SearchBar } from '../components/SearchBar';
import { SearchResults } from '../components/SearchResults';
import { usePagedQuery } from '../hooks/usePagedQuery';

const TYPES: DocumentType[] = DocumentTypeSchema.options;

interface SearchFilters {
  q: string;
  type: DocumentType | '';
  recipient: string;
  dateFrom: string;
  dateTo: string;
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const initialType = (searchParams.get('type') as DocumentType | null) ?? '';

  const [q, setQ] = useState(initialQ);
  const [type, setType] = useState<DocumentType | ''>(initialType);
  const [recipient, setRecipient] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handleQueryChange = (value: string): void => {
    setQ(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set('q', value);
      else next.delete('q');
      return next;
    });
  };

  const enabled = q.trim().length > 0;
  const filters: SearchFilters = { q, type, recipient, dateFrom, dateTo };

  const {
    items,
    total,
    pageSize,
    setPageSize,
    loadMore,
    isLoading,
    isFetching,
    error,
  } = usePagedQuery<SearchResult, SearchFilters>({
    baseKey: 'search',
    filters,
    enabled,
    fetcher: (f, limit, offset) =>
      searchDocuments({
        q: f.q,
        ...(f.type ? { type: f.type } : {}),
        ...(f.recipient ? { recipient: f.recipient } : {}),
        ...(f.dateFrom ? { dateFrom: f.dateFrom } : {}),
        ...(f.dateTo ? { dateTo: f.dateTo } : {}),
        limit,
        offset,
      }).then((res) => ({ items: res.results, total: res.total })),
  });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Search</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Full-text search across titles and transcriptions, ranked by SQLite FTS5 BM25.
        </p>
      </header>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <SearchBar initialValue={initialQ} onChange={handleQueryChange} />
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Type
          </span>
          <select
            className="input"
            value={type}
            onChange={(e) => setType((e.target.value as DocumentType | '') || '')}
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Recipient contains
          </span>
          <input
            className="input"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="e.g. Kermit, Lodge, Congress"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
              From
            </span>
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
              To
            </span>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
      </div>

      {!enabled && (
        <p className="text-ink-700 dark:text-parchment-100">
          Type a query to search — try <em>arena</em>, <em>conservation</em>, or <em>strenuous</em>.
        </p>
      )}
      {enabled && isLoading && items.length === 0 && <p>Searching…</p>}
      {enabled && error ? (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Search failed.'}
        </p>
      ) : null}
      {enabled && !isLoading && items.length === 0 && total === 0 && !error && (
        <p className="text-ink-700 dark:text-parchment-100">
          No matches. Try a different query or remove a filter.
        </p>
      )}
      {enabled && items.length > 0 && (
        <>
          <p className="text-sm text-ink-700/80 dark:text-parchment-100/70 mb-3">
            {total} match{total === 1 ? '' : 'es'}
          </p>
          <SearchResults results={items} />
          <LoadMore
            itemsLength={items.length}
            total={total}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onLoadMore={loadMore}
            isFetching={isFetching}
          />
        </>
      )}
    </div>
  );
}
