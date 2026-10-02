import type { SearchMode } from '@tr/shared';

const OPTIONS: Array<{ value: SearchMode; label: string; hint: string }> = [
  { value: 'lexical', label: 'Keyword', hint: 'Exact word matching (BM25)' },
  { value: 'hybrid', label: 'Hybrid', hint: 'Keyword + meaning, blended' },
  { value: 'semantic', label: 'Natural language', hint: 'Search by meaning' },
];

interface SearchModeToggleProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}

export function SearchModeToggle({ mode, onChange }: SearchModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Search mode"
      className="inline-flex overflow-hidden rounded-md border border-ink-700/15 dark:border-parchment-50/15"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.hint}
          aria-pressed={mode === option.value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1.5 text-sm ${
            mode === option.value
              ? 'bg-accent-500 text-white'
              : 'hover:bg-parchment-200/60 dark:hover:bg-ink-700'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
