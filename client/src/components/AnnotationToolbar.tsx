import { useEffect, useState, type RefObject } from 'react';

import type { AnnotationCreateInput, AnnotationMotivation } from '@tr/shared';

import { useAuth } from '../auth/AuthContext';
import {
  captureSelectionToTarget,
  captureSelectionWithin,
  type CapturedSelection,
} from '../lib/selection';

interface AnnotationToolbarProps {
  documentId: string;
  rootRef: RefObject<HTMLElement>;
  onSave: (input: AnnotationCreateInput) => Promise<void>;
}

interface ToolbarState {
  capture: CapturedSelection;
  rect: { left: number; top: number };
}

export function AnnotationToolbar({ documentId, rootRef, onSave }: AnnotationToolbarProps) {
  const { user } = useAuth();
  const [state, setState] = useState<ToolbarState | null>(null);
  const [editing, setEditing] = useState<{ motivation: AnnotationMotivation } | null>(null);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const root = rootRef.current;
    if (!root) return;

    const handler = (): void => {
      const sel = window.getSelection();
      if (!sel) {
        setState(null);
        return;
      }
      const capture = captureSelectionWithin(sel, root);
      if (!capture) {
        setState(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setState({
        capture,
        rect: {
          left: rect.left + window.scrollX + rect.width / 2,
          top: rect.top + window.scrollY,
        },
      });
    };

    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
    };
  }, [rootRef, user]);

  if (!user || !state) return null;

  async function persist(motivation: AnnotationMotivation): Promise<void> {
    if (!state) return;
    if (motivation === 'commenting' && body.trim().length === 0) return;
    setSaving(true);
    try {
      const input: AnnotationCreateInput = {
        documentId,
        sectionId: null,
        motivation,
        target: captureSelectionToTarget(documentId, null, state.capture),
        ...(motivation === 'commenting' ? { bodyText: body.trim() } : {}),
      };
      await onSave(input);
      setBody('');
      setEditing(null);
      setState(null);
      window.getSelection()?.removeAllRanges();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Annotation toolbar"
      style={{
        position: 'absolute',
        left: state.rect.left,
        top: Math.max(0, state.rect.top - 48),
        transform: 'translateX(-50%)',
        zIndex: 40,
      }}
      className="max-w-[calc(100vw-1rem)] rounded-md border border-ink-700/20 bg-white shadow-lg dark:border-parchment-50/20 dark:bg-ink-800"
    >
      {!editing ? (
        <div className="flex flex-wrap items-center gap-1 p-1">
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => {
              void persist('highlighting');
            }}
          >
            Highlight
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => setEditing({ motivation: 'commenting' })}
          >
            Add note
          </button>
        </div>
      ) : (
        <div className="w-[min(calc(100vw-2rem),18rem)] space-y-2 p-2">
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a scholarly note…"
            className="input min-h-[5rem]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => {
                setEditing(null);
                setBody('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || body.trim().length === 0}
              onClick={() => {
                void persist('commenting');
              }}
            >
              Save note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
