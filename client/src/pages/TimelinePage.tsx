import { useQuery } from '@tanstack/react-query';

import { fetchDocuments } from '../api/client';
import { Timeline } from '../components/Timeline';

export function TimelinePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['documents', 'all-for-timeline'],
    queryFn: () => fetchDocuments({ limit: 100 }),
  });

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Timeline</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          A chronological view of imported documents. Click a marker — or focus it and press
          Enter — to open the document.
        </p>
      </header>
      {isLoading && <p>Loading…</p>}
      {error && (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load documents.'}
        </p>
      )}
      {data && <Timeline documents={data.items} />}
    </div>
  );
}
