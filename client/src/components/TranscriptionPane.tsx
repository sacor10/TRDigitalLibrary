import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Annotation,
  AnnotationCollection,
  AnnotationCreateInput,
  AnnotationPatch,
  Document,
} from '@tr/shared';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';


import {
  createAnnotation,
  deleteAnnotation,
  listDocumentAnnotations,
  patchAnnotation,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { locateAnnotationRange, type AnnotationRange } from '../lib/selection';

import { AnnotationPopover } from './AnnotationPopover';
import { AnnotationToolbar } from './AnnotationToolbar';
import { AnnotationsSidePanel } from './AnnotationsSidePanel';

interface TranscriptionPaneProps {
  document: Document;
  onSidebarChange?: (sidebar: ReactNode | null) => void;
}

type LocatedAnnotation = Annotation & { range: AnnotationRange | null };

interface Segment {
  start: number;
  end: number;
  annotationIds: string[];
}

function errorMessage(err: unknown): string | null {
  return err instanceof Error ? err.message : null;
}

function buildSegments(
  paragraph: string,
  paragraphStart: number,
  ranges: { id: string; range: AnnotationRange }[],
): Segment[] {
  const paragraphEnd = paragraphStart + paragraph.length;
  const overlapping = ranges.filter(
    ({ range }) => range.start < paragraphEnd && range.end > paragraphStart,
  );
  const points = new Set<number>([0, paragraph.length]);
  for (const { range } of overlapping) {
    points.add(Math.max(0, range.start - paragraphStart));
    points.add(Math.min(paragraph.length, range.end - paragraphStart));
  }
  const sorted = [...points].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i] ?? 0;
    const e = sorted[i + 1] ?? 0;
    if (e <= s) continue;
    const segStart = paragraphStart + s;
    const segEnd = paragraphStart + e;
    const annotationIds = overlapping
      .filter(({ range }) => range.start <= segStart && range.end >= segEnd)
      .map(({ id }) => id);
    segments.push({ start: s, end: e, annotationIds });
  }
  return segments;
}

export function TranscriptionPane({ document, onSidebarChange }: TranscriptionPaneProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const rootRef = useRef<HTMLElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const location = useLocation();

  const annotationsQuery = useQuery({
    queryKey: ['annotations', document.id],
    queryFn: () => listDocumentAnnotations(document.id),
    enabled: Boolean(document.transcription),
  });

  const fullText = useMemo(() => {
    if (!document.transcription) return '';
    return document.transcription.split(/\n{2,}/).join('');
  }, [document.transcription]);

  const located: LocatedAnnotation[] = useMemo(() => {
    const items = annotationsQuery.data?.items ?? [];
    return items.map((a) => ({
      ...a,
      range: locateAnnotationRange(a.target.selector, fullText),
    }));
  }, [annotationsQuery.data, fullText]);

  const validRanges = useMemo(
    () =>
      located
        .filter((a): a is LocatedAnnotation & { range: AnnotationRange } => a.range !== null)
        .map((a) => ({ id: a.id, range: a.range })),
    [located],
  );

  const createMut = useMutation({
    mutationFn: (input: AnnotationCreateInput) => createAnnotation(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['annotations', document.id] });
    },
  });
  const patchMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AnnotationPatch }) =>
      patchAnnotation(id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData<AnnotationCollection>(
        ['annotations', document.id],
        (existing) =>
          existing
            ? {
                ...existing,
                items: existing.items.map((annotation) =>
                  annotation.id === updated.id ? updated : annotation,
                ),
              }
            : existing,
      );
      setActiveId(updated.id);
      void queryClient.invalidateQueries({ queryKey: ['annotations', document.id] });
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAnnotation(id),
    onSuccess: (_deleted, id) => {
      queryClient.setQueryData<AnnotationCollection>(
        ['annotations', document.id],
        (existing) =>
          existing
            ? {
                ...existing,
                total: Math.max(0, existing.total - 1),
                items: existing.items.filter((annotation) => annotation.id !== id),
              }
            : existing,
      );
      void queryClient.invalidateQueries({ queryKey: ['annotations', document.id] });
      setActiveId(null);
    },
  });

  useEffect(() => {
    patchMut.reset();
    deleteMut.reset();
  }, [activeId]);

  useEffect(() => {
    if (!annotationsQuery.data) return;
    const hash = location.hash.replace(/^#/, '');
    const match = hash.match(/^anno-([^/]+)$/);
    if (!match) return;
    const id = match[1] ?? '';
    const exists = annotationsQuery.data.items.some((a) => a.id === id);
    if (!exists) return;
    setActiveId(id);
    requestAnimationFrame(() => {
      const el = window.document.querySelector<HTMLElement>(`[data-anno-id="${CSS.escape(id)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('anno-flash');
        window.setTimeout(() => el.classList.remove('anno-flash'), 1600);
      }
    });
  }, [location.hash, annotationsQuery.data]);

  const activeAnnotation = activeId ? (located.find((a) => a.id === activeId) ?? null) : null;
  const handleSelectAnnotation = useCallback((id: string) => {
    setActiveId((current) => (current === id ? null : id));
  }, []);
  const handleDeleteAnnotation = useCallback(
    async (id: string) => {
      await deleteMut.mutateAsync(id);
    },
    [deleteMut.mutateAsync],
  );
  const handlePatchAnnotation = useCallback(
    async (id: string, patch: AnnotationPatch) => {
      await patchMut.mutateAsync({ id, patch });
    },
    [patchMut.mutateAsync],
  );
  const annotationSidebar = useMemo(() => {
    if (!document.transcription) return null;
    return (
      <div className="space-y-4">
        <AnnotationsSidePanel
          annotations={located}
          activeId={activeId}
          onSelect={handleSelectAnnotation}
        />
        {activeAnnotation && (
          <AnnotationPopover
            annotation={activeAnnotation}
            onClose={() => setActiveId(null)}
            onDelete={handleDeleteAnnotation}
            onPatch={handlePatchAnnotation}
            mutationError={errorMessage(patchMut.error ?? deleteMut.error)}
          />
        )}
      </div>
    );
  }, [
    activeAnnotation,
    activeId,
    deleteMut.error,
    document.transcription,
    handleDeleteAnnotation,
    handlePatchAnnotation,
    handleSelectAnnotation,
    located,
    patchMut.error,
  ]);

  useEffect(() => {
    if (!onSidebarChange) return;
    onSidebarChange(annotationSidebar);
    return () => onSidebarChange(null);
  }, [annotationSidebar, onSidebarChange]);

  if (!document.transcription) {
    return (
      <article className="max-w-none space-y-3 rounded-md border border-dashed border-ink-700/20 p-4 dark:border-parchment-50/20 sm:p-6">
        {import.meta.env.DEV ? (
          <p>
            No cached transcription is available. This document was imported from a remote source. Run
            <code className="mx-1">npm run ingest-loc -- --limit 25</code> with network access,
            or read it directly at the source:
          </p>
        ) : (
          <p>
            No cached transcription is available in this deployment. You can read the document
            directly at the source:
          </p>
        )}
        {document.sourceUrl && (
          <p>
            <a href={document.sourceUrl} target="_blank" rel="noreferrer" className="underline">
              {document.sourceUrl}
            </a>
          </p>
        )}
      </article>
    );
  }

  const paragraphs = document.transcription.split(/\n{2,}/);
  let cursor = 0;
  const renderedParagraphs = paragraphs.map((p, i) => {
    const paragraphStart = cursor;
    cursor += p.length;
    const segments = buildSegments(p, paragraphStart, validRanges);
    return (
      <p key={i}>
        {segments.map((seg, j) => {
          const text = p.slice(seg.start, seg.end);
          if (seg.annotationIds.length === 0) {
            return <Fragment key={j}>{text}</Fragment>;
          }
          const top = seg.annotationIds[seg.annotationIds.length - 1] ?? '';
          const isActive = top === activeId;
          const style: CSSProperties | undefined = isActive
            ? { outline: '2px solid currentColor', outlineOffset: '2px' }
            : undefined;
          return (
            <mark
              key={j}
              data-anno-id={top}
              data-anno-ids={seg.annotationIds.join(',')}
              style={style}
              onClick={() => handleSelectAnnotation(top)}
              className="cursor-pointer"
            >
              {text}
            </mark>
          );
        })}
      </p>
    );
  });

  const transcriptionContent = (
    <div className="relative min-w-0">
      <article
        ref={rootRef}
        className="max-w-none space-y-4 text-base leading-relaxed sm:text-lg"
        aria-describedby={user ? 'annotation-help' : undefined}
      >
        {renderedParagraphs}
      </article>
      {user && (
        <p
          id="annotation-help"
          className="mt-4 text-xs text-ink-700/60 dark:text-parchment-50/60"
        >
          Select any passage to highlight or attach a note.
        </p>
      )}
      <AnnotationToolbar
        documentId={document.id}
        rootRef={rootRef}
        onSave={async (input) => {
          await createMut.mutateAsync(input);
        }}
      />
    </div>
  );

  if (onSidebarChange) {
    return transcriptionContent;
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      {transcriptionContent}
      {annotationSidebar}
    </div>
  );
}
