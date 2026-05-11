import { useQuery } from '@tanstack/react-query';
import { DocumentTypeSchema, type Document, type DocumentType } from '@tr/shared';
import { useMemo, useState } from 'react';

import { fetchDocuments, fetchTopics, searchDocuments } from '../api/client';
import { Timeline } from '../components/Timeline';

const TYPES: DocumentType[] = DocumentTypeSchema.options;

interface TimelineDocuments {
  items: Document[];
  total: number;
}

export function TimelinePage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<DocumentType | ''>('');
  const [recipient, setRecipient] = useState('');
  const [topicId, setTopicId] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  const numericTopicId = topicId ? Number(topicId) : undefined;
  const filters = useMemo(
    () => ({
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(type ? { type } : {}),
      ...(recipient ? { recipient } : {}),
      ...(numericTopicId !== undefined ? { topicId: numericTopicId } : {}),
    }),
    [dateFrom, dateTo, numericTopicId, recipient, type],
  );

  const timelineQuery = useQuery<TimelineDocuments>({
    queryKey: ['documents', 'timeline', dateFrom, dateTo, keyword, type, recipient, topicId],
    queryFn: async () => {
      const q = keyword.trim();
      if (q) {
        const result = await searchDocuments({ q, ...filters, limit: 100, offset: 0 });
        return { items: result.results.map((r) => r.document), total: result.total };
      }
      return fetchDocuments({
        ...filters,
        sort: 'date',
        order: 'asc',
        limit: 100,
      });
    },
  });

  const topicsQuery = useQuery({ queryKey: ['topics', 'timeline-filter'], queryFn: fetchTopics });

  const data = timelineQuery.data;
  const isLoading = timelineQuery.isLoading;
  const error = timelineQuery.error;

  const clearSelection = (): void => {
    setSelectedDocumentId(null);
  };

  const resetFilters = (): void => {
    setDateFrom('');
    setDateTo('');
    setKeyword('');
    setType('');
    setRecipient('');
    setTopicId('');
    clearSelection();
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Timeline</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Focus the chronology by date, keyword, topic, type, or correspondent. Click a marker to
          zoom to six months; click the selected marker again to open the document.
        </p>
      </header>

      <form
        className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_repeat(5,minmax(0,1fr))_auto] xl:items-end"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Timeline filters"
      >
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Keyword
          </span>
          <input
            type="search"
            className="input"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              clearSelection();
            }}
            placeholder="arena, conservation, strenuous"
            aria-label="Search transcriptions and titles"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Topic
          </span>
          <select
            className="input"
            value={topicId}
            onChange={(e) => {
              setTopicId(e.target.value);
              clearSelection();
            }}
            disabled={topicsQuery.isLoading}
          >
            <option value="">All topics</option>
            {(topicsQuery.data?.items ?? []).map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Type
          </span>
          <select
            className="input"
            value={type}
            onChange={(e) => {
              setType((e.target.value as DocumentType | '') || '');
              clearSelection();
            }}
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            Recipient
          </span>
          <input
            className="input"
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              clearSelection();
            }}
            placeholder="Kermit, Lodge"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            From
          </span>
          <input
            type="date"
            className="input"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              clearSelection();
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
            To
          </span>
          <input
            type="date"
            className="input"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              clearSelection();
            }}
          />
        </label>
        <button type="button" className="btn" onClick={resetFilters}>
          Reset filters
        </button>
      </form>

      {topicsQuery.error && (
        <p className="mb-3 text-sm text-red-600 dark:text-red-400">
          {topicsQuery.error instanceof Error ? topicsQuery.error.message : 'Failed to load topics.'}
        </p>
      )}
      {isLoading && <p>Loading&hellip;</p>}
      {error && (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load documents.'}
        </p>
      )}
      {data && (
        <p className="mb-3 text-sm text-ink-700/80 dark:text-parchment-100/70">
          {data.total} matching document{data.total === 1 ? '' : 's'}
          {data.total > data.items.length ? `; showing the first ${data.items.length}` : ''}
        </p>
      )}
      {data && (
        <Timeline
          documents={data.items}
          dateFrom={dateFrom}
          dateTo={dateTo}
          selectedDocumentId={selectedDocumentId}
          onDateRangeChange={(range) => {
            setDateFrom(range.dateFrom);
            setDateTo(range.dateTo);
            setSelectedDocumentId(range.selectedDocumentId);
          }}
        />
      )}
    </div>
  );
}
