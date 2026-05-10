import type { Annotation } from '@tr/shared';
import { useState } from 'react';


import { annotationJsonLdUrl } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { annotationToJsonLdString } from '../lib/jsonld';

interface AnnotationPopoverProps {
  annotation: Annotation;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onPatch: (id: string, bodyText: string) => Promise<void>;
}

export function AnnotationPopover({
  annotation,
  onClose,
  onDelete,
  onPatch,
}: AnnotationPopoverProps) {
  const { user } = useAuth();
  const isAuthor = user?.id === annotation.creator.id;
  const initialBody = annotation.body?.[0]?.value ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialBody);
  const [busy, setBusy] = useState(false);

  const permalink = `${window.location.origin}/annotations/${annotation.id}`;

  function copy(text: string): void {
    void navigator.clipboard?.writeText(text);
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

      {editing && (
        <div className="mt-2 space-y-2">
          <textarea
            className="input min-h-[5rem]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setEditing(false);
                setDraft(initialBody);
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || draft.trim().length === 0}
              onClick={() => {
                setBusy(true);
                onPatch(annotation.id, draft.trim())
                  .then(() => setEditing(false))
                  .finally(() => setBusy(false));
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <button type="button" className="btn" onClick={() => copy(permalink)}>
          Copy link
        </button>
        <a className="btn" href={annotationJsonLdUrl(annotation.id)} target="_blank" rel="noreferrer">
          Open JSON-LD
        </a>
        <button
          type="button"
          className="btn"
          onClick={() => copy(annotationToJsonLdString(annotation))}
        >
          Copy as JSON-LD
        </button>
        {isAuthor && annotation.motivation === 'commenting' && !editing && (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {isAuthor && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              if (!window.confirm('Delete this annotation?')) return;
              setBusy(true);
              onDelete(annotation.id).finally(() => setBusy(false));
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
