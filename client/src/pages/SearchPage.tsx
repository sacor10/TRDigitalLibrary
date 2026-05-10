import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { DocumentTypeSchema, type DocumentType } from '@tr/shared';

import { searchDocuments } from '../api/client';
import { SearchBar } from '../components/SearchBar';
import { SearchResults } from '../components/SearchResults';

const TYPES: DocumentType[] = DocumentTypeSchema.options;

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const initialType = (searchParams.get('type') as DocumentType | null) ?? '';

  const [q, setQ] = useState(initialQ);
  const [type, setType] = useState<DocumentType | ''>(initialType);
  const [recipient, setRecipient] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handleQueryChange = (value: string): void => {
    setQ(value);
    if (value) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('q', value);
        return next;
      });
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('q');
        return next;
      });
    }
  };

  const enabled = q.trim().length > 0;
  const { data, isLoading, error } = useQuery({
    queryKey: ['search', { q, type, recipient, dateFrom, dateTo }],
    queryFn: () =>
      searchDocuments({
        q,
        ...(type ? { type } : {}),
        ...(recipient ? { recipient } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        limit: 20,
      }),
    enabled,
  });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Search</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Full-text search across titles and transcriptions, ranked by SQLite FTS5 BM25.
        </p>
      </header>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <SearchBar initialValue={initialQ} onChange={handleQueryChange} />
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Type
          </span>
          <select
            className="input"
            value={type}
            onChange={(e) => setType((e.target.value as DocumentType | '') || '')}
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
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
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="e.g. Kermit, Lodge, Congress"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
              From
            </span>
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
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
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
      </div>

      {!enabled && (
        <p className="text-ink-700 dark:text-parchment-100">
          Type a query to search — try <em>arena</em>, <em>conservation</em>, or <em>strenuous</em>.
        </p>
      )}
      {enabled && isLoading && <p>Searching…</p>}
      {enabled && error && (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Search failed.'}
        </p>
      )}
      {enabled && data && (
        <>
          <p className="text-sm text-ink-700/80 dark:text-parchment-100/70 mb-3">
            {data.total} match{data.total === 1 ? '' : 'es'}
          </p>
          <SearchResults results={data.results} />
        </>
      )}
    </div>
  );
}
