import { useEffect } from 'react';

export type ResultsView = 'expanded' | 'compact';

const STORAGE_KEY = 'tr-results-view';

export function isResultsView(value: string | null): value is ResultsView {
  return value === 'expanded' || value === 'compact';
}

/**
 * Resolves the initial results view from (in order) the URL `view` param, the
 * persisted localStorage preference, then the `expanded` default.
 */
export function initialResultsView(urlValue: string | null): ResultsView {
  if (isResultsView(urlValue)) return urlValue;
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isResultsView(stored)) return stored;
  }
  return 'expanded';
}

interface ResultsViewToggleProps {
  view: ResultsView;
  onChange: (view: ResultsView) => void;
}

export function ResultsViewToggle({ view, onChange }: ResultsViewToggleProps) {
  // Keep the persisted preference in sync so it survives navigation/reloads.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, view);
    }
  }, [view]);

  return (
    <div
      role="group"
      aria-label="Results view"
      className="inline-flex overflow-hidden rounded-md border border-ink-700/15 dark:border-parchment-50/15"
    >
      {(['expanded', 'compact'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          onClick={() => onChange(option)}
          className={`px-3 py-1.5 text-sm capitalize ${
            view === option
              ? 'bg-accent-500 text-white'
              : 'hover:bg-parchment-200/60 dark:hover:bg-ink-700'
          }`}
        >
          {option === 'expanded' ? 'Expanded' : 'Index'}
        </button>
      ))}
    </div>
  );
}
