import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';

import { getAnnotation } from '../api/client';

export function AnnotationPage() {
  const { id } = useParams<{ id: string }>();
  const annotationId = id ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['annotation', annotationId],
    queryFn: () => getAnnotation(annotationId),
    enabled: annotationId.length > 0,
  });

  if (!annotationId) return <p>Missing annotation id.</p>;
  if (isLoading) return <p className="py-12 text-center">Resolving annotation…</p>;
  if (error || !data) {
    return (
      <p className="py-12 text-center text-red-600 dark:text-red-400">
        Annotation not found.
      </p>
    );
  }

  return <Navigate replace to={`/documents/${data.documentId}#anno-${data.id}`} />;
}
