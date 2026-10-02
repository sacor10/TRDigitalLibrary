// Lazy-loaded via "Load more" (chosen for accessibility over IntersectionObserver).
import { type Document, type DocumentListResponse, type DocumentType } from '@tr/shared';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { fetchDocuments } from '../api/client';
import { CompactDocumentList } from '../components/CompactDocumentList';
import { DocumentList } from '../components/DocumentList';
import { BrowseFilters } from '../components/filters/BrowseFilters';
import { LoadMore } from '../components/LoadMore';
import { LoadingModal } from '../components/LoadingModal';
import { FilterButtonBar } from '../components/mobile/FilterButtonBar';
import { FilterSheet } from '../components/mobile/FilterSheet';
import { MobileDocumentList } from '../components/mobile/MobileDocumentList';
import {
  initialResultsView,
  ResultsViewToggle,
  type ResultsView,
} from '../components/ResultsViewToggle';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePagedQuery } from '../hooks/usePagedQuery';

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
  const isMobile = useIsMobile();
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
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

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

  // Filter handlers wrap state + URL mirroring so they're reusable inline / in sheet.
  const handleType = (next: DocumentType | ''): void => {
    setType(next);
    setUrlParam('type', next);
  };
  const handleSource = (next: string): void => {
    setSource(next);
    setUrlParam('source', next);
  };
  const handleTag = (next: string): void => {
    setTag(next);
    setUrlParam('tag', next);
  };
  const handlePeriod = ({ dateFrom: from, dateTo: to }: { dateFrom: string; dateTo: string }): void => {
    setDateFrom(from);
    setDateTo(to);
    setUrlParam('dateFrom', from);
    setUrlParam('dateTo', to);
  };
  const handleView = (next: ResultsView): void => {
    setView(next);
    setUrlParam('view', next);
  };
  const clearAllFilters = (): void => {
    handleType('');
    handleSource('');
    handleTag('');
    handlePeriod({ dateFrom: '', dateTo: '' });
    setSort('date');
    setOrder('asc');
  };
  const activeFilterCount =
    [type, source, tag].filter(Boolean).length + (dateFrom || dateTo ? 1 : 0);

  const filters = (
    <BrowseFilters
      type={type}
      onTypeChange={handleType}
      sort={sort}
      onSortChange={setSort}
      order={order}
      onOrderChange={setOrder}
      source={source}
      onSourceChange={handleSource}
      tag={tag}
      onTagChange={handleTag}
      dateFrom={dateFrom}
      dateTo={dateTo}
      onPeriodSelect={handlePeriod}
      availableTypes={availableTypes}
      hasMultipleTypes={hasMultipleTypes}
      typeFacets={facets?.types ?? []}
      sourceFacets={sourceFacets}
      tagFacets={tagFacets}
    />
  );

  const statusBlocks = (
    <>
      {isLoading && items.length === 0 && <LoadingModal message="Loading documents..." />}
      {error ? (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load documents.'}
        </p>
      ) : null}
      {items.length === 0 && !isLoading && !error && (
        <p className="text-ink-700 dark:text-parchment-100">No documents match these filters.</p>
      )}
    </>
  );

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Browse the collection</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          {isLoading && items.length === 0 ? 'Loading...' : `${total} documents`}
        </p>
      </header>

      {isMobile ? (
        <>
          <FilterButtonBar
            activeCount={activeFilterCount}
            onOpen={() => setFilterSheetOpen(true)}
            view={view}
            onChangeView={handleView}
          />
          <FilterSheet
            open={filterSheetOpen}
            onClose={() => setFilterSheetOpen(false)}
            onClear={clearAllFilters}
            resultCount={total}
          >
            {filters}
          </FilterSheet>
          {statusBlocks}
          {items.length > 0 && (
            <>
              {view === 'compact' ? (
                <CompactDocumentList documents={items} />
              ) : (
                <MobileDocumentList
                  documents={items}
                  groupByYear={sort === 'date'}
                  headerTopClass="top-[6.75rem]"
                />
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
        </>
      ) : (
        <>
          {filters}
          {statusBlocks}
          {items.length > 0 && (
            <>
              <div className="mb-3 flex justify-end">
                <ResultsViewToggle view={view} onChange={handleView} />
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
        </>
      )}
    </div>
  );
}
