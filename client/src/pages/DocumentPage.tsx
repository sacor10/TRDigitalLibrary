import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchDocument, fetchDocumentSentiment } from '../api/client';
import { DocumentViewer } from '../components/DocumentViewer';
import { FeaturedInEssays } from '../components/FeaturedInEssays';
import { LoadingModal } from '../components/LoadingModal';
import { MetadataSidebar } from '../components/MetadataSidebar';
import { BottomSheet } from '../components/mobile/BottomSheet';
import { RelatedDocuments } from '../components/RelatedDocuments';
import { SaveToListBody } from '../components/SaveToListBody';
import { SaveToListButton } from '../components/SaveToListButton';
import { SentimentBadge } from '../components/SentimentBadge';
import { useAuth } from '../auth/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const documentId = id ?? '';
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [annotationSidebar, setAnnotationSidebar] = useState<ReactNode | null>(null);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);

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
    return <LoadingModal message="Loading document..." />;
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
    <article className={isMobile ? 'pb-20' : undefined}>
      <header className="mb-6">
        <p className="text-sm text-ink-700/80 dark:text-parchment-100/80">
          <Link to="/browse" className="underline">
            Browse
          </Link>{' '}
          / {data.type}
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl md:text-4xl">{data.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-700 dark:text-parchment-100">
          <span>{data.date}</span>
          {data.location && <span>&middot; {data.location}</span>}
          {data.recipient && <span>&middot; To {data.recipient}</span>}
          {sentiment && <SentimentBadge sentiment={sentiment} />}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
        <div className="min-w-0">
          <DocumentViewer document={data} onAnnotationSidebarChange={setAnnotationSidebar} />
        </div>
        <div className="space-y-4">
          {annotationSidebar}
          {!isMobile && <SaveToListButton documentId={documentId} />}
          <MetadataSidebar document={data} />
          <FeaturedInEssays documentId={documentId} />
          <RelatedDocuments documentId={documentId} />
        </div>
      </div>

      {isMobile && user && (
        <>
          <div
            className="fixed inset-x-0 z-30 px-4"
            style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
          >
            <button
              type="button"
              className="btn btn-primary tap w-full shadow-lg"
              onClick={() => setSaveSheetOpen(true)}
            >
              Save to a list
            </button>
          </div>
          <BottomSheet
            open={saveSheetOpen}
            onClose={() => setSaveSheetOpen(false)}
            title="Save to a list"
          >
            <SaveToListBody documentId={documentId} />
          </BottomSheet>
        </>
      )}
    </article>
  );
}
