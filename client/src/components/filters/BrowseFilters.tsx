import type { DocumentType } from '@tr/shared';

import { TYPE_LABEL } from '../../lib/documentDisplay';
import { PeriodChips } from '../PeriodChips';

type Sort = 'date' | 'title';
type Order = 'asc' | 'desc';

interface Facet<T> {
  value: T;
  count: number;
}

export interface BrowseFiltersProps {
  type: DocumentType | '';
  onTypeChange: (next: DocumentType | '') => void;
  sort: Sort;
  onSortChange: (next: Sort) => void;
  order: Order;
  onOrderChange: (next: Order) => void;
  source: string;
  onSourceChange: (next: string) => void;
  tag: string;
  onTagChange: (next: string) => void;
  dateFrom: string;
  dateTo: string;
  onPeriodSelect: (range: { dateFrom: string; dateTo: string }) => void;
  availableTypes: DocumentType[];
  hasMultipleTypes: boolean;
  typeFacets: Array<Facet<DocumentType>>;
  sourceFacets: Array<Facet<string>>;
  tagFacets: Array<Facet<string>>;
}

/**
 * Browse filter controls (period chips, type/sort/order, source & topic facets).
 * Rendered inline on desktop and inside the FilterSheet on mobile — identical
 * markup so the desktop layout is unchanged.
 */
export function BrowseFilters({
  type,
  onTypeChange,
  sort,
  onSortChange,
  order,
  onOrderChange,
  source,
  onSourceChange,
  tag,
  onTagChange,
  dateFrom,
  dateTo,
  onPeriodSelect,
  availableTypes,
  hasMultipleTypes,
  typeFacets,
  sourceFacets,
  tagFacets,
}: BrowseFiltersProps) {
  return (
    <>
      <PeriodChips dateFrom={dateFrom} dateTo={dateTo} onSelect={onPeriodSelect} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Type
          </span>
          <select
            className="input"
            value={type}
            disabled={!hasMultipleTypes}
            onChange={(e) => onTypeChange((e.target.value as DocumentType | '') || '')}
          >
            <option value="">All</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
                {typeFacets.find((facet) => facet.value === t)
                  ? ` (${typeFacets.find((facet) => facet.value === t)?.count})`
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
          <select className="input" value={sort} onChange={(e) => onSortChange(e.target.value as Sort)}>
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
            onChange={(e) => onOrderChange(e.target.value as Order)}
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
              onClick={() => onSourceChange('')}
            >
              All
            </button>
            {sourceFacets.slice(0, 12).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`chip ${source === facet.value ? 'bg-accent-500 text-white' : ''}`}
                aria-pressed={source === facet.value}
                onClick={() => onSourceChange(source === facet.value ? '' : facet.value)}
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
              onClick={() => onTagChange('')}
            >
              All
            </button>
            {tagFacets.slice(0, 12).map((facet) => (
              <button
                key={facet.value}
                type="button"
                className={`chip ${tag === facet.value ? 'bg-accent-500 text-white' : ''}`}
                aria-pressed={tag === facet.value}
                onClick={() => onTagChange(tag === facet.value ? '' : facet.value)}
              >
                {facet.value} ({facet.count})
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}
