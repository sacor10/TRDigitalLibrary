import type { DocumentType, SearchMode } from '@tr/shared';

import { AdvancedSearchForm } from '../AdvancedSearchForm';
import { SearchModeToggle } from '../SearchModeToggle';

interface Facet<T> {
  value: T;
  count: number;
}

export interface SearchFilterControlsProps {
  types: DocumentType[];
  type: DocumentType | '';
  onTypeChange: (next: DocumentType | '') => void;
  recipient: string;
  onRecipientChange: (next: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (next: string) => void;
  onDateToChange: (next: string) => void;
  mode: SearchMode;
  onModeChange: (next: SearchMode) => void;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onApplyAdvanced: (compiled: string) => void;
  source: string;
  onSourceChange: (next: string) => void;
  tag: string;
  onTagChange: (next: string) => void;
  typeFacets: Array<Facet<DocumentType>>;
  sourceFacets: Array<Facet<string>>;
  tagFacets: Array<Facet<string>>;
}

/** Search filter controls for the mobile filter sheet (the query input lives on the page). */
export function SearchFilterControls({
  types,
  type,
  onTypeChange,
  recipient,
  onRecipientChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  mode,
  onModeChange,
  showAdvanced,
  onToggleAdvanced,
  onApplyAdvanced,
  source,
  onSourceChange,
  tag,
  onTagChange,
  typeFacets,
  sourceFacets,
  tagFacets,
}: SearchFilterControlsProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          Mode
        </p>
        <SearchModeToggle mode={mode} onChange={onModeChange} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          Type
        </span>
        <select
          className="input"
          value={type}
          onChange={(e) => onTypeChange((e.target.value as DocumentType | '') || '')}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
              {typeFacets.find((facet) => facet.value === t)
                ? ` (${typeFacets.find((facet) => facet.value === t)?.count})`
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
          onChange={(e) => onRecipientChange(e.target.value)}
          placeholder="e.g. Kermit, Lodge, Congress"
        />
      </label>

      <div className="grid gap-2 grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            From
          </span>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
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
            onChange={(e) => onDateToChange(e.target.value)}
          />
        </label>
      </div>

      <div>
        <button
          type="button"
          className="text-sm text-accent-500 hover:underline"
          aria-expanded={showAdvanced}
          onClick={onToggleAdvanced}
        >
          {showAdvanced ? 'Hide advanced search' : 'Advanced search'}
        </button>
        {showAdvanced && (
          <div className="mt-3">
            <AdvancedSearchForm onApply={onApplyAdvanced} />
          </div>
        )}
      </div>

      {sourceFacets.length > 0 && (
        <fieldset>
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
        <fieldset>
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
    </div>
  );
}
