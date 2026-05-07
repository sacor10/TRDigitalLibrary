import { useEffect, useState } from 'react';

interface SearchBarProps {
  initialValue?: string;
  onChange: (value: string) => void;
  delayMs?: number;
}

export function SearchBar({ initialValue = '', onChange, delayMs = 250 }: SearchBarProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    const handle = window.setTimeout(() => onChange(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs, onChange]);

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
        Search
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. arena, conservation, strenuous"
        className="input"
        aria-label="Search transcriptions and titles"
      />
    </label>
  );
}
