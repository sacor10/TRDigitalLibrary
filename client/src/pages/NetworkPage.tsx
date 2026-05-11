import { useQuery } from '@tanstack/react-query';
import type {
  CorrespondentDirection,
  CorrespondentGraphQuery,
  CorrespondentItem,
} from '@tr/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchCorrespondentGraph, fetchCorrespondentItems } from '../api/client';
import { CorrespondentGraph } from '../components/CorrespondentGraph';

const ITEM_PAGE_SIZE = 25;

interface FilterState {
  q: string;
  dateFrom: string;
  dateTo: string;
  direction: CorrespondentDirection;
  minLetters: number;
  limit: number;
}

function graphQuery(filters: FilterState): Partial<CorrespondentGraphQuery> {
  return {
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    direction: filters.direction,
    minLetters: filters.minLetters,
    limit: filters.limit,
  };
}

function directionLabel(direction: CorrespondentDirection): string {
  if (direction === 'from-tr') return 'From TR';
  if (direction === 'to-tr') return 'To TR';
  return 'Either direction';
}

function sourceRecordPath(item: CorrespondentItem): string {
  return item.documentId ? `/documents/${encodeURIComponent(item.documentId)}` : '/browse';
}

export function NetworkPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [itemOffset, setItemOffset] = useState(0);
  const [filters, setFilters] = useState<FilterState>({
    q: '',
    dateFrom: '',
    dateTo: '',
    direction: 'all',
    minLetters: 1,
    limit: 80,
  });

  const query = useMemo(() => graphQuery(filters), [filters]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['correspondents-graph', query],
    queryFn: () => fetchCorrespondentGraph(query),
  });

  const selectedNode = useMemo(() => {
    if (!data || !selectedId) return null;
    return data.nodes.find((n) => n.id === selectedId) ?? null;
  }, [data, selectedId]);

  useEffect(() => {
    if (!data || !selectedId) return;
    if (!data.nodes.some((n) => n.id === selectedId)) setSelectedId(null);
  }, [data, selectedId]);

  useEffect(() => {
    setItemOffset(0);
  }, [selectedId, query]);

  const itemsQuery = useQuery({
    queryKey: ['correspondent-items', selectedId, query, itemOffset],
    enabled: Boolean(selectedId),
    queryFn: () =>
      fetchCorrespondentItems(selectedId!, {
        ...(query.dateFrom ? { dateFrom: query.dateFrom } : {}),
        ...(query.dateTo ? { dateTo: query.dateTo } : {}),
        direction: query.direction ?? 'all',
        limit: ITEM_PAGE_SIZE,
        offset: itemOffset,
      }),
  });

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setItemOffset(0);
  };

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedId(null);
  };

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold sm:text-3xl">Network of correspondents</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Theodore Roosevelt Center correspondence metadata, grouped by creator and recipient.
        </p>
      </header>

      <section className="mb-5 grid gap-3 rounded-md border border-ink-700/10 bg-parchment-50/50 p-3 dark:border-parchment-50/10 dark:bg-ink-800/40 md:grid-cols-[minmax(12rem,1.2fr)_repeat(5,minmax(7rem,0.8fr))]">
        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Search
          </span>
          <input
            className="input"
            value={filters.q}
            onChange={(e) => updateFilter('q', e.target.value)}
            placeholder="Name or title"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            From
          </span>
          <input
            className="input"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => updateFilter('dateFrom', e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            To
          </span>
          <input
            className="input"
            type="date"
            value={filters.dateTo}
            onChange={(e) => updateFilter('dateTo', e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Direction
          </span>
          <select
            className="input"
            value={filters.direction}
            onChange={(e) => updateFilter('direction', e.target.value as CorrespondentDirection)}
          >
            <option value="all">Either</option>
            <option value="from-tr">From TR</option>
            <option value="to-tr">To TR</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Min
          </span>
          <input
            className="input"
            type="number"
            min={1}
            max={1000}
            value={filters.minLetters}
            onChange={(e) =>
              updateFilter('minLetters', Math.max(1, Number(e.target.value) || 1))
            }
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Top
          </span>
          <input
            className="input"
            type="number"
            min={1}
            max={200}
            value={filters.limit}
            onChange={(e) => updateFilter('limit', Math.max(1, Number(e.target.value) || 80))}
          />
        </label>
      </section>

      {isLoading && <p>Loading&hellip;</p>}
      {error && (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load the correspondent graph.'}
        </p>
      )}

      {data && (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-xs text-ink-700/80 dark:text-parchment-100/80">
            <span className="chip">{data.totalItems} source items</span>
            <span className="chip">{data.totalCorrespondents} correspondents</span>
            <span className="chip">{data.edges.length} displayed edges</span>
            <span className="chip">{directionLabel(filters.direction)}</span>
          </div>

          {data.nodes.length === 0 ? (
            <p className="text-ink-700/80 dark:text-parchment-100/80">
              No TRC correspondence metadata has been ingested for these filters.
            </p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
              <section
                aria-label="Correspondent network graph"
                className="min-w-0 overflow-hidden rounded-md border border-ink-700/10 bg-parchment-50/40 dark:border-parchment-50/10 dark:bg-ink-800/40"
              >
                <CorrespondentGraph
                  nodes={data.nodes}
                  edges={data.edges}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                  height="min(72vh, 560px)"
                />
                <p className="border-t border-ink-700/10 px-3 py-2 text-xs text-ink-700/75 dark:border-parchment-50/10 dark:text-parchment-100/70">
                  Arrows show direction. Select a node to focus its exchange with Theodore
                  Roosevelt.
                </p>
              </section>

              <aside className="flex flex-col gap-4 text-sm">
                {!selectedNode && (
                  <div className="text-ink-700/80 dark:text-parchment-100/80">
                    <p>{data.nodes.length} nodes currently visible.</p>
                  </div>
                )}

                {selectedNode && (
                  <>
                    <div>
                      <h2 className="text-xl font-semibold">{selectedNode.label}</h2>
                      <p className="mt-1 text-ink-700/80 dark:text-parchment-100/80">
                        {selectedNode.totalCount} items &middot; {selectedNode.outboundCount} sent
                        &middot; {selectedNode.inboundCount} received
                      </p>
                      {(selectedNode.firstDate || selectedNode.lastDate) && (
                        <p className="text-ink-700/70 dark:text-parchment-100/70">
                          {selectedNode.firstDate ?? 'unknown'} to{' '}
                          {selectedNode.lastDate ?? 'unknown'}
                        </p>
                      )}
                    </div>

                    <div>
                      <h3 className="mb-2 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
                        Source Records
                      </h3>
                      {itemsQuery.isLoading && <p>Loading records&hellip;</p>}
                      {itemsQuery.error && (
                        <p className="text-red-600 dark:text-red-400">
                          {itemsQuery.error instanceof Error
                            ? itemsQuery.error.message
                            : 'Failed to load source records.'}
                        </p>
                      )}
                      {itemsQuery.data && itemsQuery.data.items.length === 0 && (
                        <p className="text-ink-700/70 dark:text-parchment-100/70">
                          No records match the active filters.
                        </p>
                      )}
                      {itemsQuery.data && itemsQuery.data.items.length > 0 && (
                        <>
                          <ul className="flex flex-col gap-3">
                            {itemsQuery.data.items.map((item) => (
                              <li key={item.id}>
                                <Link
                                  className="font-medium underline decoration-accent-500/50 hover:decoration-accent-500"
                                  to={sourceRecordPath(item)}
                                >
                                  {item.title}
                                </Link>
                                <p className="text-ink-700/70 dark:text-parchment-100/70">
                                  {item.dateDisplay ?? item.date ?? 'undated'} &middot;{' '}
                                  {item.resourceType}
                                </p>
                                <p className="text-ink-700/80 dark:text-parchment-100/80">
                                  {item.creators.map((p) => p.rawName).join('; ') || 'Unknown'} to{' '}
                                  {item.recipients.map((p) => p.rawName).join('; ') || 'Unknown'}
                                </p>
                              </li>
                            ))}
                          </ul>

                          <div className="mt-4 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="btn"
                              disabled={itemOffset === 0}
                              onClick={() => setItemOffset((v) => Math.max(0, v - ITEM_PAGE_SIZE))}
                            >
                              Previous
                            </button>
                            <span className="text-xs text-ink-700/70 dark:text-parchment-100/70">
                              {itemOffset + 1}-
                              {Math.min(itemOffset + ITEM_PAGE_SIZE, itemsQuery.data.total)} of{' '}
                              {itemsQuery.data.total}
                            </span>
                            <button
                              type="button"
                              className="btn"
                              disabled={itemOffset + ITEM_PAGE_SIZE >= itemsQuery.data.total}
                              onClick={() => setItemOffset((v) => v + ITEM_PAGE_SIZE)}
                            >
                              Next
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  );
}
