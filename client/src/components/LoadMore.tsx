import { PAGE_SIZE_OPTIONS } from '../hooks/usePagedQuery';

export interface LoadMoreProps {
  itemsLength: number;
  total: number;
  pageSize: number;
  onPageSizeChange: (n: number) => void;
  onLoadMore: () => void;
  isFetching: boolean;
}

export function LoadMore({
  itemsLength,
  total,
  pageSize,
  onPageSizeChange,
  onLoadMore,
  isFetching,
}: LoadMoreProps) {
  if (total === 0) return null;
  const hasMore = itemsLength < total;
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink-700/80 dark:text-parchment-100/70">
        Showing {itemsLength} of {total}
      </p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          Per page
          <select
            className="input"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Items per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {hasMore && (
          <button
            type="button"
            className="btn"
            onClick={onLoadMore}
            disabled={isFetching}
          >
            {isFetching ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
