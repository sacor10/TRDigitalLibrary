import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { fetchDocument, fetchDocumentSentiment } from '../api/client';
import { DocumentViewer } from '../components/DocumentViewer';
import { MetadataSidebar } from '../components/MetadataSidebar';
import { SentimentBadge } from '../components/SentimentBadge';

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const documentId = id ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => fetchDocument(documentId),
    enabled: documentId.length > 0,
  });
  const { data: sentiment } = useQuery({
    queryKey: ['document-sentiment', documentId],
    queryFn: () => fetchDocumentSentiment(documentId),
    enabled: documentId.length > 0,
  });

  if (!documentId) {
    return <p>Missing document id.</p>;
  }
  if (isLoading) {
    return <p className="py-12 text-center">Loading document…</p>;
  }
  if (error || !data) {
    return (
      <div className="py-12 text-center">
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Document not found.'}
        </p>
        <Link to="/browse" className="btn mt-4">
          Back to browse
        </Link>
      </div>
    );
  }

  return (
    <article>
      <header className="mb-6">
        <p className="text-sm text-ink-700/80 dark:text-parchment-100/80">
          <Link to="/browse" className="underline">
            Browse
          </Link>{' '}
          / {data.type}
        </p>
        <h1 className="text-3xl md:text-4xl font-semibold mt-2">{data.title}</h1>
        <p className="mt-2 text-sm text-ink-700 dark:text-parchment-100 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{data.date}</span>
          {data.location && <span>&middot; {data.location}</span>}
          {data.recipient && <span>&middot; To {data.recipient}</span>}
          {sentiment && <SentimentBadge sentiment={sentiment} />}
        </p>
      </header>

      <div className="grid lg:grid-cols-[1fr_320px] gap-8">
        <div>
          <DocumentViewer document={data} />
        </div>
        <MetadataSidebar document={data} />
      </div>
    </article>
  );
}
