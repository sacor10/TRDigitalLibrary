import { TR_LIFE_PERIODS } from '@tr/shared';
import { Link } from 'react-router-dom';

/** Browse-by-period landing page. Each card seeds the browse date filters. */
export function PeriodsPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Browse by period</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Explore the collection through the chapters of Theodore Roosevelt&rsquo;s life.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TR_LIFE_PERIODS.map((period) => (
          <li key={period.id}>
            <Link
              to={`/browse?dateFrom=${period.dateFrom}&dateTo=${period.dateTo}`}
              className="card flex h-full flex-col gap-2 transition-shadow hover:shadow-md"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-semibold text-lg leading-tight">{period.label}</h2>
                <span className="text-xs whitespace-nowrap text-ink-700/70 dark:text-parchment-100/60">
                  {period.dateFrom.slice(0, 4)}&ndash;{period.dateTo.slice(0, 4)}
                </span>
              </div>
              <p className="text-sm text-ink-700 dark:text-parchment-100">{period.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
