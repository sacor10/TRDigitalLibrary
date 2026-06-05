// Lazy-loaded via "Load more" (chosen for accessibility over IntersectionObserver).
// `q` input is debounced inside <SearchBar> (250 ms) so this page doesn't fetch on every keystroke.
import { DocumentTypeSchema, type DocumentType, type SearchResult } from '@tr/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { fetchDocuments, searchDocuments } from '../api/client';
import { AdvancedSearchForm } from '../components/AdvancedSearchForm';
import { CompactDocumentList } from '../components/CompactDocumentList';
import { LoadMore } from '../components/LoadMore';
import { LoadingModal } from '../components/LoadingModal';
import {
  initialResultsView,
  ResultsViewToggle,
  type ResultsView,
} from '../components/ResultsViewToggle';
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
  tag: string;
  source: string;
}

interface SearchPageResponse {
  items: SearchResult[];
  total: number;
  facets?: {
    types: Array<{ value: DocumentType; count: number }>;
    tags: Array<{ value: string; count: number }>;
    sources: Array<{ value: string; count: number }>;
  };
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const initialType = (searchParams.get('type') as DocumentType | null) ?? '';
  const initialRecipient = searchParams.get('recipient') ?? '';
  const initialDateFrom = searchParams.get('dateFrom') ?? '';
  const initialDateTo = searchParams.get('dateTo') ?? '';
  const initialTag = searchParams.get('tag') ?? '';
  const initialSource = searchParams.get('source') ?? '';

  const [q, setQ] = useState(initialQ);
  const [type, setType] = useState<DocumentType | ''>(initialType);
  const [recipient, setRecipient] = useState(initialRecipient);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [tag, setTag] = useState(initialTag);
  const [source, setSource] = useState(initialSource);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [view, setView] = useState<ResultsView>(() =>
    initialResultsView(searchParams.get('view')),
  );

  const setUrlParam = (name: string, value: string): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        next.delete('offset');
        return next;
      },
      { replace: true },
    );
  };

  const handleQueryChange = (value: string): void => {
    setQ(value);
    setUrlParam('q', value);
  };

  const trimmedQ = q.trim();
  const trimmedRecipient = recipient.trim();
  const enabled =
    trimmedQ.length > 0 ||
    type !== '' ||
    trimmedRecipient.length > 0 ||
    dateFrom !== '' ||
    dateTo !== '' ||
    tag !== '' ||
    source !== '';
  const filters: SearchFilters = {
    q: trimmedQ,
    type,
    recipient: trimmedRecipient,
    dateFrom,
    dateTo,
    tag,
    source,
  };

  const {
    items,
    total,
    pageSize,
    setPageSize,
    loadMore,
    isLoading,
    isFetching,
    error,
    data,
  } = usePagedQuery<SearchResult, SearchFilters, SearchPageResponse>({
    baseKey: 'search',
    filters,
    enabled,
    fetcher: (f, limit, offset) => {
      const commonFilters = {
        ...(f.type ? { type: f.type } : {}),
        ...(f.recipient ? { recipient: f.recipient } : {}),
        ...(f.dateFrom ? { dateFrom: f.dateFrom } : {}),
        ...(f.dateTo ? { dateTo: f.dateTo } : {}),
        ...(f.tag ? { tag: f.tag } : {}),
        ...(f.source ? { source: f.source } : {}),
        limit,
        offset,
      };

      if (f.q) {
        return searchDocuments({
          q: f.q,
          ...commonFilters,
        }).then((res) => ({ items: res.results, total: res.total, facets: res.facets }));
      }

      return fetchDocuments(commonFilters).then((res) => ({
        items: res.items.map((document) => ({ document, snippet: '' })),
        total: res.total,
        facets: res.facets,
      }));
    },
  });
  const facets = data?.facets;
  const tagFacets = facets?.tags ?? [];
  const sourceFacets = facets?.sources ?? [];

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Search</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Full-text search across titles and transcriptions, ranked by SQLite FTS5 BM25.
        </p>
      </header>

      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <SearchBar initialValue={initialQ} onChange={handleQueryChange} />
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Type
          </span>
          <select
            className="input"
            value={type}
            onChange={(e) => {
              const next = (e.target.value as DocumentType | '') || '';
              setType(next);
              setUrlParam('type', next);
            }}
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
                {facets?.types.find((facet) => facet.value === t)
                  ? ` (${facets.types.find((facet) => facet.value === t)?.count})`
                  : ''}
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
            onChange={(e) => {
              setRecipient(e.target.value);
              setUrlParam('recipient', e.target.value.trim());
            }}
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
              onChange={(e) => {
                setDateFrom(e.target.value);
                setUrlParam('dateFrom', e.target.value);
              }}
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
              onChange={(e) => {
                setDateTo(e.target.value);
                setUrlParam('dateTo', e.target.value);
              }}
            />
          </label>
        </div>
      </div>

      <div className="mb-6">
        <button
          type="button"
          className="text-sm text-accent-500 hover:underline"
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((prev) => !prev)}
        >
          {showAdvanced ? 'Hide advanced search' : 'Advanced search'}
        </button>
      </div>

      {showAdvanced && (
        <AdvancedSearchForm
          onApply={(compiled) => {
            handleQueryChange(compiled);
          }}
        />
      )}

      {sourceFacets.length > 0 && (
        <fieldset className="mb-6">
          <legend className="mb-2 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Collection / source
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`chip ${source === '' ? 'bg-accent-500 text-white' : ''}`}
              aria-pressed={source === ''}
              onClick={() => {
                setSource('');
                setUrlParam('source', '');
              }}
            >
              All
            </button>
            {sourceFacets.slice(0, 12).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`chip ${source === facet.value ? 'bg-accent-500 text-white' : ''}`}
                aria-pressed={source === facet.value}
                onClick={() => {
                  const next = source === facet.value ? '' : facet.value;
                  setSource(next);
                  setUrlParam('source', next);
                }}
              >
                {facet.value} ({facet.count})
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {tagFacets.length > 0 && (
        <fieldset className="mb-6">
          <legend className="mb-2 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Topics
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`chip ${tag === '' ? 'bg-accent-500 text-white' : ''}`}
              aria-pressed={tag === ''}
              onClick={() => {
                setTag('');
                setUrlParam('tag', '');
              }}
            >
              All
            </button>
            {tagFacets.slice(0, 12).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`chip ${tag === facet.value ? 'bg-accent-500 text-white' : ''}`}
                aria-pressed={tag === facet.value}
                onClick={() => {
                  const next = tag === facet.value ? '' : facet.value;
                  setTag(next);
                  setUrlParam('tag', next);
                }}
              >
                {facet.value} ({facet.count})
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {!enabled && (
        <p className="text-ink-700 dark:text-parchment-100">
          Type a query or add a filter to search — try <em>arena</em>, <em>conservation</em>, or{' '}
          <em>strenuous</em>.
        </p>
      )}
      {enabled && isLoading && items.length === 0 && <LoadingModal message="Searching..." />}
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-ink-700/80 dark:text-parchment-100/70">
              {total} match{total === 1 ? '' : 'es'}
            </p>
            <ResultsViewToggle
              view={view}
              onChange={(next) => {
                setView(next);
                setUrlParam('view', next);
              }}
            />
          </div>
          {view === 'compact' ? (
            <CompactDocumentList documents={items.map((result) => result.document)} />
          ) : (
            <SearchResults results={items} />
          )}
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
