import { useMemo, useState } from 'react';

/**
 * Friendly advanced-search form. Each labeled field compiles to the `field:`
 * query syntax already understood by the search route's `buildFtsQuery`
 * (`server/src/routes/search.ts`). The compiled string is shown as a live
 * preview so power users learn the syntax, then handed to the page's existing
 * query handler — no new API surface.
 */
interface AdvancedFields {
  keywords: string;
  title: string;
  recipient: string;
  tag: string;
  collection: string;
  year: string;
}

const EMPTY: AdvancedFields = {
  keywords: '',
  title: '',
  recipient: '',
  tag: '',
  collection: '',
  year: '',
};

/** Wrap a value in quotes when it contains whitespace so a scope stays atomic. */
function scopeToken(field: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const needsQuotes = /\s/.test(trimmed);
  return `${field}:${needsQuotes ? `"${trimmed}"` : trimmed}`;
}

export function compileAdvancedQuery(fields: AdvancedFields): string {
  const parts: string[] = [];
  if (fields.keywords.trim()) parts.push(fields.keywords.trim());
  parts.push(scopeToken('title', fields.title));
  parts.push(scopeToken('recipient', fields.recipient));
  parts.push(scopeToken('tag', fields.tag));
  parts.push(scopeToken('collection', fields.collection));
  if (/^\d{4}$/.test(fields.year.trim())) parts.push(`date:${fields.year.trim()}`);
  return parts.filter(Boolean).join(' ');
}

interface AdvancedSearchFormProps {
  onApply: (compiledQuery: string) => void;
}

export function AdvancedSearchForm({ onApply }: AdvancedSearchFormProps) {
  const [fields, setFields] = useState<AdvancedFields>(EMPTY);
  const compiled = useMemo(() => compileAdvancedQuery(fields), [fields]);
  const set = (key: keyof AdvancedFields) => (value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const ROWS: Array<{ key: keyof AdvancedFields; label: string; placeholder: string }> = [
    { key: 'keywords', label: 'All of these words', placeholder: 'e.g. conservation forests' },
    { key: 'title', label: 'In the title', placeholder: 'e.g. annual message' },
    { key: 'recipient', label: 'Recipient', placeholder: 'e.g. Lodge' },
    { key: 'tag', label: 'Topic tag', placeholder: 'e.g. Conservation' },
    { key: 'collection', label: 'Collection / source', placeholder: 'e.g. Library of Congress' },
    { key: 'year', label: 'Year', placeholder: 'e.g. 1905' },
  ];

  return (
    <form
      className="mb-6 rounded-md border border-ink-700/15 p-4 dark:border-parchment-50/15"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(compiled);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {ROWS.map((row) => (
          <label key={row.key} className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
              {row.label}
            </span>
            <input
              className="input"
              value={fields[row.key]}
              inputMode={row.key === 'year' ? 'numeric' : undefined}
              onChange={(e) => set(row.key)(e.target.value)}
              placeholder={row.placeholder}
            />
          </label>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-700/70 dark:text-parchment-100/60">
          Compiled query:{' '}
          {compiled ? (
            <code className="rounded bg-parchment-200/70 px-1 py-0.5 dark:bg-ink-700">
              {compiled}
            </code>
          ) : (
            <em>empty</em>
          )}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFields(EMPTY);
              onApply('');
            }}
          >
            Clear
          </button>
          <button type="submit" className="btn bg-accent-500 text-white" disabled={!compiled}>
            Search
          </button>
        </div>
      </div>
    </form>
  );
}
