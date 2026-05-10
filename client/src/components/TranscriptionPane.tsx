import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useLocation } from 'react-router-dom';

import type { Annotation, AnnotationCreateInput, Document } from '@tr/shared';

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
}

type LocatedAnnotation = Annotation & { range: AnnotationRange | null };

interface Segment {
  start: number;
  end: number;
  annotationIds: string[];
}

function buildSegments(paragraph: string, paragraphStart: number, ranges: { id: string; range: AnnotationRange }[]): Segment[] {
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
      .filter(
        ({ range }) =>
          range.start <= segStart && range.end >= segEnd,
      )
      .map(({ id }) => id);
    segments.push({ start: s, end: e, annotationIds });
  }
  return segments;
}

export function TranscriptionPane({ document }: TranscriptionPaneProps) {
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
    mutationFn: ({ id, bodyText }: { id: string; bodyText: string }) =>
      patchAnnotation(id, { bodyText }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['annotations', document.id] });
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAnnotation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['annotations', document.id] });
      setActiveId(null);
    },
  });

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
      const el = window.document.querySelector<HTMLElement>(
        `[data-anno-id="${CSS.escape(id)}"]`,
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('anno-flash');
        window.setTimeout(() => el.classList.remove('anno-flash'), 1600);
      }
    });
  }, [location.hash, annotationsQuery.data]);

  if (!document.transcription) {
    return (
      <article className="max-w-none p-6 rounded-md border border-dashed border-ink-700/20 dark:border-parchment-50/20 space-y-3">
        {import.meta.env.DEV ? (
          <p>
            No cached transcription is available. This document is seeded from a remote source. Run
            <code className="mx-1">npm run seed</code> with network access, or read it directly at the
            source:
          </p>
        ) : (
          <p>
            No cached transcription is available in this deployment. You can read the document directly
            at the source:
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
              onClick={() => setActiveId(top)}
              className="cursor-pointer"
            >
              {text}
            </mark>
          );
        })}
      </p>
    );
  });

  const activeAnnotation = activeId
    ? located.find((a) => a.id === activeId) ?? null
    : null;

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6">
      <div className="relative">
        <article
          ref={rootRef}
          className="max-w-none leading-relaxed space-y-4 text-base"
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
        {activeAnnotation && (
          <AnnotationPopover
            annotation={activeAnnotation}
            onClose={() => setActiveId(null)}
            onDelete={async (id) => {
              await deleteMut.mutateAsync(id);
            }}
            onPatch={async (id, bodyText) => {
              await patchMut.mutateAsync({ id, bodyText });
            }}
          />
        )}
      </div>
      <AnnotationsSidePanel
        annotations={located}
        activeId={activeId}
        onSelect={(id) => setActiveId(id)}
      />
    </div>
  );
}
