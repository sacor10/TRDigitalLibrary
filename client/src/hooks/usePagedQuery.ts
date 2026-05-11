import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function clampPageSize(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_PAGE_SIZE);
}

export interface PagedQueryResult<T> {
  items: T[];
  total: number;
  pageSize: number;
  setPageSize: (n: number) => void;
  loadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
}

export interface PagedQueryArgs<T, F> {
  baseKey: string;
  filters: F;
  fetcher: (filters: F, limit: number, offset: number) => Promise<{ items: T[]; total: number }>;
  enabled?: boolean;
}

export function usePagedQuery<T, F>({
  baseKey,
  filters,
  fetcher,
  enabled = true,
}: PagedQueryArgs<T, F>): PagedQueryResult<T> {
  const [searchParams, setSearchParams] = useSearchParams();
  const pageSize = clampPageSize(searchParams.get('limit'));

  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);

  const resetKey = `${JSON.stringify(filters)}|${pageSize}`;
  const prevResetKey = useRef(resetKey);
  useEffect(() => {
    if (prevResetKey.current === resetKey) return;
    prevResetKey.current = resetKey;
    setOffset(0);
    setItems([]);
    setTotal(0);
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.delete('offset');
        return sp;
      },
      { replace: true },
    );
  }, [resetKey, setSearchParams]);

  const query = useQuery({
    queryKey: [baseKey, filters, pageSize, offset],
    queryFn: () => fetcher(filters, pageSize, offset),
    enabled,
  });

  const appliedRef = useRef<string>('');
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    const fingerprint = `${resetKey}|${offset}|${data.total}|${data.items.length}`;
    if (appliedRef.current === fingerprint) return;
    appliedRef.current = fingerprint;
    setTotal(data.total);
    if (offset === 0) {
      setItems(data.items);
    } else {
      setItems((prev) => [...prev, ...data.items]);
    }
  }, [query.data, offset, resetKey]);

  const hasMore = total > 0 && items.length < total;

  const loadMore = useCallback(() => {
    if (!hasMore || query.isFetching) return;
    const next = items.length;
    setOffset(next);
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.set('offset', String(next));
      sp.set('limit', String(pageSize));
      return sp;
    });
  }, [hasMore, items.length, pageSize, query.isFetching, setSearchParams]);

  const setPageSize = useCallback(
    (n: number) => {
      const clamped = Math.min(Math.max(Math.trunc(n) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set('limit', String(clamped));
          sp.delete('offset');
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    items,
    total,
    pageSize,
    setPageSize,
    loadMore,
    hasMore,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
