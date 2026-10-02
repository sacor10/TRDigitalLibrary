import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { createCollection, fetchCollections } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LoadingModal } from '../components/LoadingModal';
import { BottomSheet } from '../components/mobile/BottomSheet';
import { useIsMobile } from '../hooks/useIsMobile';

export function MyListsPage() {
  const { user, loading } = useAuth();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);

  const listsQuery = useQuery({
    queryKey: ['collections'],
    queryFn: fetchCollections,
    enabled: Boolean(user),
  });

  const createMutation = useMutation({
    mutationFn: () => createCollection({ title: title.trim() }),
    onSuccess: () => {
      setTitle('');
      setFeedback(null);
      setCreateSheetOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err) =>
      setFeedback(err instanceof Error ? err.message : 'Failed to create list.'),
  });

  if (loading) return <LoadingModal message="Loading…" />;

  if (!user) {
    return (
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">My lists</h1>
        <p className="mt-2 text-ink-700 dark:text-parchment-100">
          Sign in to create research lists and save documents.
        </p>
      </div>
    );
  }

  const createForm = (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) {
          setFeedback('Please enter a list name.');
          return;
        }
        createMutation.mutate();
      }}
    >
      <input
        className="input flex-1"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (feedback) setFeedback(null);
        }}
        placeholder="New list name"
        aria-label="New list name"
      />
      <button
        type="submit"
        className="btn bg-accent-500 text-white"
        disabled={createMutation.isPending}
      >
        {createMutation.isPending ? 'Creating…' : 'Create list'}
      </button>
    </form>
  );

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">My lists</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Organize documents into research lists. Public lists are shareable by link.
        </p>
      </header>

      {isMobile ? (
        <>
          <button
            type="button"
            className="btn btn-primary tap mb-6 w-full"
            onClick={() => setCreateSheetOpen(true)}
          >
            New list
          </button>
          <BottomSheet
            open={createSheetOpen}
            onClose={() => setCreateSheetOpen(false)}
            title="New list"
          >
            {createForm}
            {feedback && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
                {feedback}
              </p>
            )}
          </BottomSheet>
        </>
      ) : (
        <>
          <div className="mb-6">{createForm}</div>
          {feedback && (
            <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
              {feedback}
            </p>
          )}
        </>
      )}

      {listsQuery.isLoading && <LoadingModal message="Loading your lists…" />}
      {listsQuery.isError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {listsQuery.error instanceof Error
            ? listsQuery.error.message
            : 'Failed to load your lists.'}
        </p>
      )}
      {listsQuery.data && listsQuery.data.items.length === 0 && (
        <p className="text-ink-700 dark:text-parchment-100">
          No lists yet. Create one above, or use “Save to a list” on any document.
        </p>
      )}
      {listsQuery.data && listsQuery.data.items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {listsQuery.data.items.map((collection) => (
            <li key={collection.id}>
              <Link
                to={`/lists/${collection.id}`}
                className="card flex h-full flex-col gap-1 transition-shadow hover:shadow-md"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-semibold leading-tight">{collection.title}</h2>
                  {collection.isPublic && <span className="chip text-[10px]">Public</span>}
                </div>
                {collection.description && (
                  <p className="text-sm text-ink-700 dark:text-parchment-100">
                    {collection.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-ink-700/60 dark:text-parchment-100/50">
                  {collection.itemCount} document{collection.itemCount === 1 ? '' : 's'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
