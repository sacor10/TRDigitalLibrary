import { TR_LIFE_PERIODS } from '@tr/shared';

interface PeriodChipsProps {
  /** Currently-selected date range, used to highlight a matching period chip. */
  dateFrom: string;
  dateTo: string;
  onSelect: (range: { dateFrom: string; dateTo: string }) => void;
}

/**
 * Quick-pick row of TR life periods. Selecting a chip seeds the existing
 * dateFrom/dateTo filters; selecting the active chip again clears the range.
 */
export function PeriodChips({ dateFrom, dateTo, onSelect }: PeriodChipsProps) {
  return (
    <fieldset className="mb-6">
      <legend className="mb-2 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
        Jump to a period
      </legend>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`chip ${dateFrom === '' && dateTo === '' ? 'bg-accent-500 text-white' : ''}`}
          aria-pressed={dateFrom === '' && dateTo === ''}
          onClick={() => onSelect({ dateFrom: '', dateTo: '' })}
        >
          All years
        </button>
        {TR_LIFE_PERIODS.map((period) => {
          const active = dateFrom === period.dateFrom && dateTo === period.dateTo;
          return (
            <button
              key={period.id}
              type="button"
              title={period.blurb}
              className={`chip ${active ? 'bg-accent-500 text-white' : ''}`}
              aria-pressed={active}
              onClick={() =>
                onSelect(
                  active
                    ? { dateFrom: '', dateTo: '' }
                    : { dateFrom: period.dateFrom, dateTo: period.dateTo },
                )
              }
            >
              {period.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
