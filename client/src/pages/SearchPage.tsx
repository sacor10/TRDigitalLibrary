// Lazy-loaded via "Load more" (chosen for accessibility over IntersectionObserver).
// `q` input is debounced inside <SearchBar> (250 ms) so this page doesn't fetch on every keystroke.
import {
  DocumentTypeSchema,
  type DocumentType,
  type SearchMode,
  type SearchResult,
} from '@tr/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { fetchDocuments, searchDocuments } from '../api/client';
import { AdvancedSearchForm } from '../components/AdvancedSearchForm';
import { CompactDocumentList } from '../components/CompactDocumentList';
import { SearchFilterControls } from '../components/filters/SearchFilterControls';
import { LoadMore } from '../components/LoadMore';
import { LoadingModal } from '../components/LoadingModal';
import { FilterButtonBar } from '../components/mobile/FilterButtonBar';
import { FilterSheet } from '../components/mobile/FilterSheet';
import { MobileSearchResults } from '../components/mobile/MobileSearchResults';
import {
  initialResultsView,
  ResultsViewToggle,
  type ResultsView,
} from '../components/ResultsViewToggle';
import { SearchBar } from '../components/SearchBar';
import { SearchModeToggle } from '../components/SearchModeToggle';
import { SearchResults } from '../components/SearchResults';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePagedQuery } from '../hooks/usePagedQuery';

const TYPES: DocumentType[] = DocumentTypeSchema.options;

function isSearchMode(value: string | null): value is SearchMode {
  return value === 'lexical' || value === 'hybrid' || value === 'semantic';
}

interface SearchFilters {
  q: string;
  type: DocumentType | '';
  recipient: string;
  dateFrom: string;
  dateTo: string;
  tag: string;
  source: string;
  mode: SearchMode;
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
  const isMobile = useIsMobile();
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
  const initialMode = searchParams.get('mode');
  const [mode, setMode] = useState<SearchMode>(isSearchMode(initialMode) ? initialMode : 'lexical');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [view, setView] = useState<ResultsView>(() =>
    initialResultsView(searchParams.get('view')),
  );
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

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
    mode,
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
          mode: f.mode,
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
  // The server computes facets only on the first page (offset 0); "Load more"
  // responses omit them to avoid redundant full scans. Retain the first page's
  // facets so the type/topic/source chips don't vanish when paginating, and
  // reset them whenever the search itself changes.
  const [stickyFacets, setStickyFacets] = useState<SearchPageResponse['facets']>();
  const searchKey = JSON.stringify({
    q: trimmedQ,
    type,
    recipient: trimmedRecipient,
    dateFrom,
    dateTo,
    tag,
    source,
    mode,
  });
  useEffect(() => {
    setStickyFacets(undefined);
  }, [searchKey]);
  useEffect(() => {
    const next = data?.facets;
    if (next && (next.types.length > 0 || next.tags.length > 0 || next.sources.length > 0)) {
      setStickyFacets(next);
    }
  }, [data]);

  const facets = stickyFacets ?? data?.facets;
  const tagFacets = facets?.tags ?? [];
  const sourceFacets = facets?.sources ?? [];

  // Filter handlers (state + URL mirroring) reused by the mobile filter sheet.
  const handleType = (next: DocumentType | ''): void => {
    setType(next);
    setUrlParam('type', next);
  };
  const handleRecipient = (next: string): void => {
    setRecipient(next);
    setUrlParam('recipient', next.trim());
  };
  const handleDateFrom = (next: string): void => {
    setDateFrom(next);
    setUrlParam('dateFrom', next);
  };
  const handleDateTo = (next: string): void => {
    setDateTo(next);
    setUrlParam('dateTo', next);
  };
  const handleMode = (next: SearchMode): void => {
    setMode(next);
    setUrlParam('mode', next === 'lexical' ? '' : next);
  };
  const handleSource = (next: string): void => {
    setSource(next);
    setUrlParam('source', next);
  };
  const handleTag = (next: string): void => {
    setTag(next);
    setUrlParam('tag', next);
  };
  const handleView = (next: ResultsView): void => {
    setView(next);
    setUrlParam('view', next);
  };
  const clearAllFilters = (): void => {
    handleType('');
    handleRecipient('');
    handleDateFrom('');
    handleDateTo('');
    handleTag('');
    handleSource('');
    handleMode('lexical');
  };
  const activeFilterCount =
    [type, trimmedRecipient, tag, source].filter(Boolean).length +
    (dateFrom || dateTo ? 1 : 0) +
    (mode !== 'lexical' ? 1 : 0);

  const header = (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">Search</h1>
      <p className="text-ink-700 dark:text-parchment-100 mt-1">
        Full-text search across titles and transcriptions, ranked by SQLite FTS5 BM25.
      </p>
    </header>
  );

  const resultStatus = (
    <>
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
    </>
  );

  if (isMobile) {
    return (
      <div>
        {header}
        <div className="sticky top-12 z-20 -mx-4 mb-3 bg-parchment-50/95 px-4 py-2 backdrop-blur dark:bg-ink-900/95">
          <SearchBar initialValue={initialQ} onChange={handleQueryChange} />
        </div>
        <FilterButtonBar
          activeCount={activeFilterCount}
          onOpen={() => setFilterSheetOpen(true)}
          view={view}
          onChangeView={handleView}
          topClass="top-[6.5rem]"
        />
        <FilterSheet
          open={filterSheetOpen}
          onClose={() => setFilterSheetOpen(false)}
          onClear={clearAllFilters}
          resultCount={enabled ? total : undefined}
        >
          <SearchFilterControls
            types={TYPES}
            type={type}
            onTypeChange={handleType}
            recipient={recipient}
            onRecipientChange={handleRecipient}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={handleDateFrom}
            onDateToChange={handleDateTo}
            mode={mode}
            onModeChange={handleMode}
            showAdvanced={showAdvanced}
            onToggleAdvanced={() => setShowAdvanced((prev) => !prev)}
            onApplyAdvanced={(compiled) => handleQueryChange(compiled)}
            source={source}
            onSourceChange={handleSource}
            tag={tag}
            onTagChange={handleTag}
            typeFacets={facets?.types ?? []}
            sourceFacets={sourceFacets}
            tagFacets={tagFacets}
          />
        </FilterSheet>

        {resultStatus}
        {enabled && items.length > 0 && (
          <>
            <p className="mb-2 text-sm text-ink-700/80 dark:text-parchment-100/70">
              {total} match{total === 1 ? '' : 'es'}
            </p>
            {view === 'compact' ? (
              <CompactDocumentList documents={items.map((result) => result.document)} />
            ) : (
              <MobileSearchResults results={items} />
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

  return (
    <div>
      {header}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SearchModeToggle mode={mode} onChange={handleMode} />
        {mode !== 'lexical' && (
          <span className="text-xs text-ink-700/70 dark:text-parchment-100/60">
            Ask in plain English — e.g. “TR&rsquo;s views on national parks.” Falls back to keyword
            search when semantic data isn&rsquo;t available.
          </span>
        )}
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <SearchBar initialValue={initialQ} onChange={handleQueryChange} />
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Type
          </span>
          <select
            className="input"
            value={type}
            onChange={(e) => handleType((e.target.value as DocumentType | '') || '')}
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
            onChange={(e) => handleRecipient(e.target.value)}
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
              onChange={(e) => handleDateFrom(e.target.value)}
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
              onChange={(e) => handleDateTo(e.target.value)}
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
              onClick={() => handleSource('')}
            >
              All
            </button>
            {sourceFacets.slice(0, 12).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`chip ${source === facet.value ? 'bg-accent-500 text-white' : ''}`}
                aria-pressed={source === facet.value}
                onClick={() => handleSource(source === facet.value ? '' : facet.value)}
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
              onClick={() => handleTag('')}
            >
              All
            </button>
            {tagFacets.slice(0, 12).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`chip ${tag === facet.value ? 'bg-accent-500 text-white' : ''}`}
                aria-pressed={tag === facet.value}
                onClick={() => handleTag(tag === facet.value ? '' : facet.value)}
              >
                {facet.value} ({facet.count})
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {resultStatus}
      {enabled && items.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm text-ink-700/80 dark:text-parchment-100/70">
              {total} match{total === 1 ? '' : 'es'}
            </p>
            <ResultsViewToggle view={view} onChange={handleView} />
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
