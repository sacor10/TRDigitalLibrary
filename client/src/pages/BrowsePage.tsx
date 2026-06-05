// Lazy-loaded via "Load more" (chosen for accessibility over IntersectionObserver).
import { type Document, type DocumentListResponse, type DocumentType } from '@tr/shared';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { fetchDocuments } from '../api/client';
import { CompactDocumentList } from '../components/CompactDocumentList';
import { DocumentList } from '../components/DocumentList';
import { LoadMore } from '../components/LoadMore';
import { LoadingModal } from '../components/LoadingModal';
import { PeriodChips } from '../components/PeriodChips';
import {
  initialResultsView,
  ResultsViewToggle,
  type ResultsView,
} from '../components/ResultsViewToggle';
import { usePagedQuery } from '../hooks/usePagedQuery';

const TYPE_LABEL: Record<DocumentType, string> = {
  letter: 'Letter',
  speech: 'Speech',
  diary: 'Diary',
  article: 'Memoir / Article',
  autobiography: 'Autobiography',
  manuscript: 'Manuscript',
};

type Sort = 'date' | 'title';
type Order = 'asc' | 'desc';

interface BrowseFilters {
  type: DocumentType | '';
  tag: string;
  source: string;
  dateFrom: string;
  dateTo: string;
  sort: Sort;
  order: Order;
}

export function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [type, setType] = useState<DocumentType | ''>(
    (searchParams.get('type') as DocumentType | null) ?? '',
  );
  const [tag, setTag] = useState(searchParams.get('tag') ?? '');
  const [source, setSource] = useState(searchParams.get('source') ?? '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') ?? '');
  const [sort, setSort] = useState<Sort>('date');
  const [order, setOrder] = useState<Order>('asc');
  const [view, setView] = useState<ResultsView>(() =>
    initialResultsView(searchParams.get('view')),
  );

  // Mirror filter state into the URL so periods/links and reloads stay in sync.
  const setUrlParam = (name: string, value: string): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
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
  } = usePagedQuery<Document, BrowseFilters, DocumentListResponse>({
    baseKey: 'documents',
    filters: { type, tag, source, dateFrom, dateTo, sort, order },
    fetcher: (filters, limit, offset) =>
      fetchDocuments({
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.tag ? { tag: filters.tag } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
        ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
        sort: filters.sort,
        order: filters.order,
        limit,
        offset,
      }),
  });
  const availableTypes = useMemo(() => data?.availableTypes ?? [], [data?.availableTypes]);
  const facets = data?.facets;
  const tagFacets = facets?.tags ?? [];
  const sourceFacets = facets?.sources ?? [];
  const hasMultipleTypes = availableTypes.length > 1;

  useEffect(() => {
    if (type && data && !availableTypes.includes(type)) {
      setType('');
      setUrlParam('type', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTypes, data, type]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Browse the collection</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          {isLoading && items.length === 0 ? 'Loading...' : `${total} documents`}
        </p>
      </header>

      <PeriodChips
        dateFrom={dateFrom}
        dateTo={dateTo}
        onSelect={({ dateFrom: from, dateTo: to }) => {
          setDateFrom(from);
          setDateTo(to);
          setUrlParam('dateFrom', from);
          setUrlParam('dateTo', to);
        }}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Type
          </span>
          <select
            className="input"
            value={type}
            disabled={!hasMultipleTypes}
            onChange={(e) => {
              const next = (e.target.value as DocumentType | '') || '';
              setType(next);
              setUrlParam('type', next);
            }}
          >
            <option value="">All</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
                {facets?.types.find((facet) => facet.value === t)
                  ? ` (${facets.types.find((facet) => facet.value === t)?.count})`
                  : ''}
              </option>
            ))}
          </select>
          {!hasMultipleTypes && availableTypes.length === 1 && (
            <span className="text-ink-700/70 dark:text-parchment-100/70">
              Only {TYPE_LABEL[availableTypes[0]!]} documents are currently available.
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Sort by
          </span>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="date">Date</option>
            <option value="title">Title</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Order
          </span>
          <select
            className="input"
            value={order}
            onChange={(e) => setOrder(e.target.value as Order)}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>

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

      {isLoading && items.length === 0 && <LoadingModal message="Loading documents..." />}
      {error ? (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load documents.'}
        </p>
      ) : null}
      {items.length === 0 && !isLoading && !error && (
        <p className="text-ink-700 dark:text-parchment-100">No documents match these filters.</p>
      )}
      {items.length > 0 && (
        <>
          <div className="mb-3 flex justify-end">
            <ResultsViewToggle
              view={view}
              onChange={(next) => {
                setView(next);
                setUrlParam('view', next);
              }}
            />
          </div>
          {view === 'compact' ? (
            <CompactDocumentList documents={items} />
          ) : (
            <DocumentList documents={items} />
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
