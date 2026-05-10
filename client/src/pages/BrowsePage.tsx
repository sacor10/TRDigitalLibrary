import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { DocumentTypeSchema, type DocumentType } from '@tr/shared';

import { fetchDocuments } from '../api/client';
import { DocumentList } from '../components/DocumentList';

const TYPES: DocumentType[] = DocumentTypeSchema.options;

type Sort = 'date' | 'title';
type Order = 'asc' | 'desc';

export function BrowsePage() {
  const [type, setType] = useState<DocumentType | ''>('');
  const [sort, setSort] = useState<Sort>('date');
  const [order, setOrder] = useState<Order>('asc');

  const { data, isLoading, error } = useQuery({
    queryKey: ['documents', { type, sort, order }],
    queryFn: () =>
      fetchDocuments({
        ...(type ? { type } : {}),
        sort,
        order,
      }),
  });

  const items = useMemo(() => data?.items ?? [], [data]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Browse the collection</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          {data ? `${data.total} documents` : 'Loading…'}
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
            onChange={(e) => setType((e.target.value as DocumentType | '') || '')}
          >
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
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

      {isLoading && <p>Loading…</p>}
      {error && (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load documents.'}
        </p>
      )}
      {data && <DocumentList documents={items} />}
    </div>
  );
}
