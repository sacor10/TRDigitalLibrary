// Lazy-loaded via "Load more" (chosen for accessibility over IntersectionObserver).
import { type Document, type DocumentListResponse, type DocumentType } from '@tr/shared';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { fetchDocuments } from '../api/client';
import { DocumentList } from '../components/DocumentList';
import { LoadMore } from '../components/LoadMore';
import { LoadingModal } from '../components/LoadingModal';
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
  sort: Sort;
  order: Order;
}

export function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [type, setType] = useState<DocumentType | ''>('');
  const [tag, setTag] = useState(() => searchParams.get('tag') ?? '');
  const [sort, setSort] = useState<Sort>('date');
  const [order, setOrder] = useState<Order>('asc');

  // Keep the chip click handler and a programmatic reset in one place so the
  // selected tag, the URL, and pagination state stay in sync.
  const updateTag = (next: string): void => {
    setTag(next);
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        if (next) sp.set('tag', next);
        else sp.delete('tag');
        sp.delete('offset');
        return sp;
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
    filters: { type, tag, sort, order },
    fetcher: (filters, limit, offset) =>
      fetchDocuments({
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.tag ? { tag: filters.tag } : {}),
        sort: filters.sort,
        order: filters.order,
        limit,
        offset,
      }),
  });
  const availableTypes = useMemo(() => data?.availableTypes ?? [], [data?.availableTypes]);
  const facets = data?.facets;
  const tagFacets = facets?.tags ?? [];
  const hasMultipleTypes = availableTypes.length > 1;

  // Tag chips come from the server's facet aggregate, which is reset to
  // undefined on error. We still want the user to be able to clear the
  // selected tag in that case, so we ensure the active tag is always
  // present in the chip list — synthesized with count=0 if the response
  // didn't include it (e.g. failed request, or tag not in the top-50 cut).
  const visibleTagChips = useMemo(() => {
    if (!tag) return tagFacets;
    if (tagFacets.some((facet) => facet.value === tag)) return tagFacets;
    return [{ value: tag, count: 0 }, ...tagFacets];
  }, [tag, tagFacets]);

  useEffect(() => {
    if (type && data && !availableTypes.includes(type)) {
      setType('');
    }
  }, [availableTypes, data, type]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Browse the collection</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          {isLoading && items.length === 0 ? 'Loading...' : `${total} documents`}
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Type
          </span>
          <select
            className="input"
            value={type}
            disabled={!hasMultipleTypes}
            onChange={(e) => setType((e.target.value as DocumentType | '') || '')}
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

      {visibleTagChips.length > 0 && (
        <fieldset className="mb-6">
          <legend className="mb-2 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Topics
          </legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`chip ${tag === '' ? 'bg-accent-500 text-white' : ''}`}
              aria-pressed={tag === ''}
              onClick={() => updateTag('')}
            >
              All
            </button>
            {visibleTagChips.slice(0, 12).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`chip ${tag === facet.value ? 'bg-accent-500 text-white' : ''}`}
                aria-pressed={tag === facet.value}
                onClick={() => updateTag(tag === facet.value ? '' : facet.value)}
              >
                {facet.value}
                {facet.count > 0 ? ` (${facet.count})` : ''}
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
          <DocumentList documents={items} />
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
