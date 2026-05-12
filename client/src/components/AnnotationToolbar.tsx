import type { AnnotationCreateInput, AnnotationMotivation } from '@tr/shared';
import { useEffect, useRef, useState, type RefObject } from 'react';

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

const TOOLBAR_EDGE_GUTTER = 8;
const TOOLBAR_VERTICAL_OFFSET = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function AnnotationToolbar({ documentId, rootRef, onSave }: AnnotationToolbarProps) {
  const { user } = useAuth();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const editingRef = useRef(false);
  const [state, setState] = useState<ToolbarState | null>(null);
  const [editing, setEditing] = useState<{ motivation: AnnotationMotivation } | null>(null);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    editingRef.current = editing !== null;
  }, [editing]);

  useEffect(() => {
    if (!user) return;
    const root = rootRef.current;
    if (!root) return;

    const handler = (): void => {
      const toolbarHasFocus =
        document.activeElement instanceof HTMLElement &&
        toolbarRef.current?.contains(document.activeElement);
      const sel = window.getSelection();
      if (!sel) {
        if (editingRef.current || toolbarHasFocus) return;
        setState(null);
        return;
      }
      const capture = captureSelectionWithin(sel, root);
      if (!capture) {
        if (editingRef.current || toolbarHasFocus) return;
        setState(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const offsetParent = root.offsetParent;
      const container =
        offsetParent instanceof HTMLElement ? offsetParent : (root.parentElement ?? root);
      const containerRect = container.getBoundingClientRect();
      const centeredLeft = rect.left - containerRect.left + rect.width / 2;
      const maxLeft = Math.max(TOOLBAR_EDGE_GUTTER, containerRect.width - TOOLBAR_EDGE_GUTTER);
      setState({
        capture,
        rect: {
          left: clamp(centeredLeft, TOOLBAR_EDGE_GUTTER, maxLeft),
          top: Math.max(0, rect.top - containerRect.top),
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
      ref={toolbarRef}
      role="toolbar"
      aria-label="Annotation toolbar"
      style={{
        position: 'absolute',
        left: state.rect.left,
        top: Math.max(0, state.rect.top - TOOLBAR_VERTICAL_OFFSET),
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
