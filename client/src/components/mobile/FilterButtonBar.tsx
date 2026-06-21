import { ResultsViewToggle, type ResultsView } from '../ResultsViewToggle';

import { FilterIcon } from './icons';

interface FilterButtonBarProps {
  activeCount: number;
  onOpen: () => void;
  view: ResultsView;
  onChangeView: (view: ResultsView) => void;
  /** Tailwind `top-*` for the sticky position (clears the app bar). */
  topClass?: string;
}

/** Sticky bar under the app bar: opens the filter sheet + toggles results view. */
export function FilterButtonBar({
  activeCount,
  onOpen,
  view,
  onChangeView,
  topClass = 'top-12',
}: FilterButtonBarProps) {
  return (
    <div
      className={`sticky ${topClass} z-20 -mx-4 mb-3 flex items-center justify-between gap-3 border-b border-ink-700/10 bg-parchment-50/95 px-4 py-2 backdrop-blur dark:border-parchment-50/10 dark:bg-ink-900/95`}
    >
      <button type="button" onClick={onOpen} className="btn tap gap-2">
        <FilterIcon width={18} height={18} />
        Filters
        {activeCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-xs font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>
      <ResultsViewToggle view={view} onChange={onChangeView} />
    </div>
  );
}
