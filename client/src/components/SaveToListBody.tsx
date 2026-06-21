import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { addCollectionItem, createCollection, fetchCollections } from '../api/client';

/**
 * Shared picker UI for "Save to a list": lists the user's collections and a
 * create-new form. Rendered inline on desktop (inside SaveToListButton) and in a
 * bottom sheet on mobile. Assumes the caller has confirmed the user is signed in.
 */
export function SaveToListBody({ documentId }: { documentId: string }) {
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const collectionsQuery = useQuery({
    queryKey: ['collections'],
    queryFn: fetchCollections,
  });

  const addMutation = useMutation({
    mutationFn: (collectionId: string) => addCollectionItem(collectionId, { documentId }),
    onSuccess: (_data, collectionId) => {
      setFeedback('Saved.');
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      void queryClient.invalidateQueries({ queryKey: ['collection', collectionId] });
    },
    onError: (err) => setFeedback(err instanceof Error ? err.message : 'Failed to save.'),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await createCollection({ title: newTitle.trim() });
      await addCollectionItem(created.id, { documentId });
      return created;
    },
    onSuccess: () => {
      setNewTitle('');
      setFeedback('List created and document saved.');
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
    onError: (err) => setFeedback(err instanceof Error ? err.message : 'Failed to create list.'),
  });

  return (
    <div className="space-y-3">
      {collectionsQuery.isLoading && (
        <p className="text-sm text-ink-700/70 dark:text-parchment-100/60">Loading your lists…</p>
      )}
      {collectionsQuery.data && collectionsQuery.data.items.length > 0 && (
        <ul className="grid gap-1">
          {collectionsQuery.data.items.map((collection) => (
            <li key={collection.id}>
              <button
                type="button"
                className="btn tap w-full justify-between text-left"
                disabled={addMutation.isPending}
                onClick={() => addMutation.mutate(collection.id)}
              >
                <span>{collection.title}</span>
                <span className="text-xs text-ink-700/60 dark:text-parchment-100/50">
                  {collection.itemCount} saved
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!newTitle.trim()) {
            setFeedback('Please enter a list name.');
            return;
          }
          createMutation.mutate();
        }}
      >
        <input
          className="input flex-1"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New list name"
          aria-label="New list name"
        />
        <button
          type="submit"
          className="btn tap bg-accent-500 text-white"
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>

      {feedback && (
        <p className="text-sm text-ink-700 dark:text-parchment-100" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}
