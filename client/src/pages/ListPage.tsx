import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { deleteCollection, fetchCollection, removeCollectionItem } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LoadingModal } from '../components/LoadingModal';

export function ListPage() {
  const { id } = useParams<{ id: string }>();
  const collectionId = id ?? '';
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['collection', collectionId],
    queryFn: () => fetchCollection(collectionId),
    enabled: collectionId.length > 0,
  });

  // Owner-only mutations; the API enforces ownership regardless.
  const isOwner = Boolean(user && data && user.name === data.ownerName);

  const removeMutation = useMutation({
    mutationFn: (documentId: string) => removeCollectionItem(collectionId, documentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collection', collectionId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCollection(collectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      window.location.assign('/lists');
    },
  });

  if (isLoading) return <LoadingModal message="Loading list…" />;
  if (error || !data) {
    return (
      <div>
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'List not found.'}
        </p>
        <Link to="/lists" className="mt-3 inline-block text-accent-500 hover:underline">
          ← My lists
        </Link>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold sm:text-3xl">{data.title}</h1>
          {isOwner && (
            <button
              type="button"
              className="btn text-sm text-red-600 dark:text-red-400"
              onClick={() => {
                if (window.confirm('Delete this list? This cannot be undone.')) {
                  deleteMutation.mutate();
                }
              }}
            >
              Delete list
            </button>
          )}
        </div>
        {data.description && (
          <p className="text-ink-700 dark:text-parchment-100 mt-1">{data.description}</p>
        )}
        <p className="mt-1 text-sm text-ink-700/70 dark:text-parchment-100/60">
          By {data.ownerName} · {data.itemCount} document{data.itemCount === 1 ? '' : 's'}
          {data.isPublic ? ' · Public' : ''}
        </p>
      </header>

      {data.items.length === 0 ? (
        <p className="text-ink-700 dark:text-parchment-100">This list is empty.</p>
      ) : (
        <ul className="grid gap-3">
          {data.items.map(({ document, note }) => (
            <li key={document.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/documents/${document.id}`} className="font-semibold hover:underline">
                    {document.title}
                  </Link>
                  <p className="mt-1 text-sm text-ink-700 dark:text-parchment-100">
                    {document.date} · {document.type}
                    {document.recipient && <> · To {document.recipient}</>}
                  </p>
                  {note && <p className="mt-2 text-sm italic">{note}</p>}
                </div>
                {isOwner && (
                  <button
                    type="button"
                    className="btn text-xs"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(document.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
