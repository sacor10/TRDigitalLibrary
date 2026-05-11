import type { Annotation, AnnotationMotivation, AnnotationPatch } from '@tr/shared';
import { useEffect, useState } from 'react';


import { annotationJsonLdUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { annotationToJsonLdString } from '../lib/jsonld';

interface AnnotationPopoverProps {
  annotation: Annotation;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onPatch: (id: string, patch: AnnotationPatch) => Promise<void>;
  mutationError?: string | null;
}

export function AnnotationPopover({
  annotation,
  onClose,
  onDelete,
  onPatch,
  mutationError = null,
}: AnnotationPopoverProps) {
  const { user } = useAuth();
  const isAuthor = user?.id === annotation.creator.id;
  const initialBody = annotation.body?.[0]?.value ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialBody);
  const [draftMotivation, setDraftMotivation] = useState<AnnotationMotivation>(
    annotation.motivation,
  );
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const permalink = `${window.location.origin}/annotations/${annotation.id}`;
  const pending = busy || shareBusy;
  const saveDisabled =
    pending || (draftMotivation === 'commenting' && draft.trim().length === 0);

  useEffect(() => {
    setEditing(false);
    setDraft(initialBody);
    setDraftMotivation(annotation.motivation);
    setStatus(null);
    setLocalError(null);
    setBusy(false);
    setShareBusy(false);
  }, [annotation.id, annotation.motivation, initialBody]);

  async function copy(text: string, successMessage: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard is not available in this browser.');
    }
    await navigator.clipboard.writeText(text);
    setStatus(successMessage);
  }

  async function sharePermalink(): Promise<void> {
    setShareBusy(true);
    setStatus(null);
    setLocalError(null);
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'TR Digital Library annotation',
          url: permalink,
        });
        setStatus('Shared annotation link.');
      } else {
        await copy(permalink, 'Copied public annotation link.');
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to share annotation link.');
    } finally {
      setShareBusy(false);
    }
  }

  async function copyJsonLd(): Promise<void> {
    setShareBusy(true);
    setStatus(null);
    setLocalError(null);
    try {
      await copy(annotationToJsonLdString(annotation), 'Copied annotation JSON-LD.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to copy JSON-LD.');
    } finally {
      setShareBusy(false);
    }
  }

  async function saveEdit(): Promise<void> {
    const patch: AnnotationPatch =
      draftMotivation === 'highlighting'
        ? { motivation: 'highlighting' }
        : { motivation: 'commenting', bodyText: draft.trim() };
    setBusy(true);
    setStatus(null);
    setLocalError(null);
    try {
      await onPatch(annotation.id, patch);
      setEditing(false);
      setStatus('Annotation updated.');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to update annotation.');
    } finally {
      setBusy(false);
    }
  }

  async function removeAnnotation(): Promise<void> {
    if (!window.confirm('Remove this annotation? This cannot be undone.')) return;
    setBusy(true);
    setStatus(null);
    setLocalError(null);
    try {
      await onDelete(annotation.id);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to remove annotation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-4" id={`anno-${annotation.id}`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm">
            <span className="font-medium">{annotation.creator.name}</span>{' '}
            <span className="text-ink-700/70 dark:text-parchment-50/70">
              · {new Date(annotation.created).toLocaleDateString()}
            </span>{' '}
            <span className="chip text-[0.65rem]">{annotation.motivation}</span>
          </p>
        </div>
        <button type="button" className="btn" onClick={onClose} aria-label="Close annotation">
          ×
        </button>
      </header>

      {!editing && annotation.motivation === 'commenting' && annotation.body && (
        <p className="mt-2 whitespace-pre-wrap">{annotation.body[0]?.value}</p>
      )}
      {!editing && annotation.motivation === 'highlighting' && (
        <p className="mt-2 text-sm text-ink-700/70 dark:text-parchment-50/70">
          Highlight only.
        </p>
      )}

      {editing && (
        <div className="mt-2 space-y-2">
          <fieldset className="flex flex-wrap gap-2 text-xs">
            <legend className="sr-only">Annotation type</legend>
            <label className="btn">
              <input
                type="radio"
                name={`annotation-type-${annotation.id}`}
                className="mr-1"
                checked={draftMotivation === 'highlighting'}
                onChange={() => setDraftMotivation('highlighting')}
                disabled={pending}
              />
              Highlight only
            </label>
            <label className="btn">
              <input
                type="radio"
                name={`annotation-type-${annotation.id}`}
                className="mr-1"
                checked={draftMotivation === 'commenting'}
                onChange={() => setDraftMotivation('commenting')}
                disabled={pending}
              />
              Note
            </label>
          </fieldset>
          {draftMotivation === 'commenting' ? (
            <textarea
              className="input min-h-[5rem]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={pending}
              aria-label="Annotation note"
            />
          ) : (
            <p className="text-xs text-ink-700/70 dark:text-parchment-50/70">
              Saving as highlight only will remove the note text but keep the highlighted passage.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditing(false);
                setDraft(initialBody);
                setDraftMotivation(annotation.motivation);
                setLocalError(null);
              }}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saveDisabled}
              onClick={() => {
                void saveEdit();
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {(status || localError || mutationError) && (
        <p
          className={`mt-3 text-xs ${
            localError || mutationError
              ? 'text-red-700 dark:text-red-300'
              : 'text-ink-700/70 dark:text-parchment-50/70'
          }`}
          role={localError || mutationError ? 'alert' : 'status'}
        >
          {localError ?? mutationError ?? status}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => {
            void sharePermalink();
          }}
        >
          {shareBusy ? 'Sharing…' : 'Share'}
        </button>
        <a className="btn" href={annotationJsonLdUrl(annotation.id)} target="_blank" rel="noreferrer">
          Open JSON-LD
        </a>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => {
            void copyJsonLd();
          }}
        >
          Copy as JSON-LD
        </button>
        {isAuthor && !editing && (
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => {
              setStatus(null);
              setLocalError(null);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
        {isAuthor && (
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => {
              void removeAnnotation();
            }}
          >
            {busy ? 'Removing…' : 'Remove'}
          </button>
        )}
      </div>
    </div>
  );
}
