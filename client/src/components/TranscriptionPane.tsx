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
import { useLocation, useSearchParams } from 'react-router-dom';

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

interface TermRange {
  start: number;
  end: number;
}

const LONG_TRANSCRIPTION_CHAR_LIMIT = 3000;
const TRANSCRIPTION_PREVIEW_WORD_LIMIT = 500;

function errorMessage(err: unknown): string | null {
  return err instanceof Error ? err.message : null;
}

function firstWords(text: string, count: number): string {
  if (count <= 0) return '';
  let seen = 0;
  for (const match of text.matchAll(/\S+/g)) {
    seen += 1;
    if (seen === count) {
      return text.slice(0, (match.index ?? 0) + match[0].length);
    }
  }
  return text;
}

function extractKeywords(rawQuery: string): string[] {
  const stripped = rawQuery.replace(/[A-Za-z]+:[^\s]+/g, ' ');
  return stripped
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((w) => w.length > 0);
}

function findTermRanges(text: string, terms: string[]): TermRange[] {
  if (!text || terms.length === 0) return [];
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const ranges: TermRange[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return ranges;
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

function renderTextWithTerms(
  text: string,
  terms: string[],
  segmentKey: string,
  isFirstMatchRef: { current: boolean },
): ReactNode {
  if (!terms.length) {
    return text;
  }
  const termRanges = findTermRanges(text, terms);
  if (termRanges.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  termRanges.forEach((range, idx) => {
    if (range.start > lastIndex) {
      nodes.push(text.slice(lastIndex, range.start));
    }
    const matchText = text.slice(range.start, range.end);
    const isFirstMatch = isFirstMatchRef.current;
    if (isFirstMatch) {
      isFirstMatchRef.current = false;
    }

    nodes.push(
      <mark
        key={`${segmentKey}-term-${idx}`}
        data-search-match="true"
        data-first-match={isFirstMatch ? 'true' : undefined}
        className="bg-yellow-200 text-ink-900 rounded-px px-0.5 dark:bg-yellow-800/80 dark:text-parchment-50 font-medium"
      >
        {matchText}
      </mark>,
    );
    lastIndex = range.end;
  });

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export function TranscriptionPane({ document, onSidebarChange }: TranscriptionPaneProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const rootRef = useRef<HTMLElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const queryParam = searchParams.get('q') ?? '';
  const searchTerms = useMemo(() => extractKeywords(queryParam), [queryParam]);

  const annotationsQuery = useQuery({
    queryKey: ['annotations', document.id],
    queryFn: () => listDocumentAnnotations(document.id),
    enabled: Boolean(document.transcription),
  });

  const fullText = useMemo(() => {
    if (!document.transcription) return '';
    return document.transcription.split(/\n{2,}/).join('');
  }, [document.transcription]);

  const previewTranscription = useMemo(
    () => firstWords(document.transcription, TRANSCRIPTION_PREVIEW_WORD_LIMIT),
    [document.transcription],
  );
  const isLongTranscription =
    document.transcription.length > LONG_TRANSCRIPTION_CHAR_LIMIT &&
    previewTranscription.length < document.transcription.length;

  // If a searched term is NOT in the preview section of the document, auto-expand
  // so the entire document is loaded and can be scrolled to.
  const termMatchesFull = useMemo(
    () => findTermRanges(document.transcription, searchTerms),
    [document.transcription, searchTerms],
  );
  const termMatchesPreview = useMemo(
    () => findTermRanges(previewTranscription, searchTerms),
    [previewTranscription, searchTerms],
  );

  const shouldAutoExpand = useMemo(() => {
    if (!isLongTranscription || searchTerms.length === 0) return false;
    // If there is any match in the document and either none in the preview or
    // we want to ensure any match is fully available
    return termMatchesFull.length > 0 && termMatchesPreview.length === 0;
  }, [isLongTranscription, searchTerms.length, termMatchesFull.length, termMatchesPreview.length]);

  const displayedTranscription =
    isLongTranscription && !isExpanded && !shouldAutoExpand
      ? previewTranscription
      : document.transcription;

  const displayedText = useMemo(() => {
    if (!displayedTranscription) return '';
    return displayedTranscription.split(/\n{2,}/).join('');
  }, [displayedTranscription]);

  useEffect(() => {
    setIsExpanded(false);
  }, [document.id, document.transcription]);

  const located: LocatedAnnotation[] = useMemo(() => {
    const items = annotationsQuery.data?.items ?? [];
    return items.map((a) => ({
      ...a,
      range: locateAnnotationRange(a.target.selector, fullText),
    }));
  }, [annotationsQuery.data, fullText]);

  const visibleLocated = useMemo(
    () =>
      located.filter(
        (a) =>
          isExpanded ||
          shouldAutoExpand ||
          a.range === null ||
          a.range.end <= displayedText.length,
      ),
    [displayedText.length, isExpanded, shouldAutoExpand, located],
  );

  const jumpToAnnotation = useCallback((id: string): void => {
    requestAnimationFrame(() => {
      const marks = rootRef.current?.querySelectorAll<HTMLElement>('[data-anno-ids]') ?? [];
      const el = [...marks].find((mark) => mark.dataset.annoIds?.split(',').includes(id));
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('anno-flash');
      window.setTimeout(() => el.classList.remove('anno-flash'), 1600);
    });
  }, []);

  const jumpToSearchMatch = useCallback((): void => {
    requestAnimationFrame(() => {
      const matchEl =
        rootRef.current?.querySelector<HTMLElement>('[data-first-match="true"]') ??
        rootRef.current?.querySelector<HTMLElement>('[data-search-match="true"]');
      if (!matchEl) return;
      matchEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      matchEl.classList.add('anno-flash');
      window.setTimeout(() => matchEl.classList.remove('anno-flash'), 1600);
    });
  }, []);

  // When search terms are present, scroll to the first matching search term
  useEffect(() => {
    if (searchTerms.length > 0 && document.transcription) {
      const timer = window.setTimeout(() => {
        jumpToSearchMatch();
      }, 150);
      return () => window.clearTimeout(timer);
    }
  }, [document.transcription, jumpToSearchMatch, searchTerms.length, isExpanded, shouldAutoExpand]);

  const validRanges = useMemo(
    () =>
      visibleLocated
        .filter((a): a is LocatedAnnotation & { range: AnnotationRange } => a.range !== null)
        .map((a) => ({ id: a.id, range: a.range })),
    [visibleLocated],
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
      queryClient.setQueryData<AnnotationCollection>(['annotations', document.id], (existing) =>
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
      queryClient.setQueryData<AnnotationCollection>(['annotations', document.id], (existing) =>
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
    jumpToAnnotation(id);
  }, [jumpToAnnotation, location.hash, annotationsQuery.data]);

  const activeAnnotation = activeId
    ? (visibleLocated.find((a) => a.id === activeId) ?? null)
    : null;
  const handleSelectAnnotation = useCallback((id: string) => {
    setActiveId((current) => (current === id ? null : id));
  }, []);
  const handleJumpAnnotation = useCallback(
    (id: string) => {
      setActiveId(id);
      jumpToAnnotation(id);
    },
    [jumpToAnnotation],
  );
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
          annotations={visibleLocated}
          activeId={activeId}
          onSelect={handleSelectAnnotation}
        />
        {activeAnnotation && (
          <AnnotationPopover
            annotation={activeAnnotation}
            onClose={() => setActiveId(null)}
            onDelete={handleDeleteAnnotation}
            onJump={handleJumpAnnotation}
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
    handleJumpAnnotation,
    handlePatchAnnotation,
    handleSelectAnnotation,
    patchMut.error,
    visibleLocated,
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
            No cached transcription is available. This document was imported from a remote source.
            Run
            <code className="mx-1">npm run ingest-loc -- --limit 25</code> with network access, or
            read it directly at the source:
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

  const paragraphs = displayedTranscription.split(/\n{2,}/);
  let cursor = 0;
  const isFirstMatchTracker = { current: true };

  const renderedParagraphs = paragraphs.map((p, i) => {
    const paragraphStart = cursor;
    cursor += p.length;
    const segments = buildSegments(p, paragraphStart, validRanges);
    return (
      <p key={i}>
        {segments.map((seg, j) => {
          const text = p.slice(seg.start, seg.end);
          const segmentKey = `p${i}-s${j}`;
          if (seg.annotationIds.length === 0) {
            return (
              <Fragment key={j}>
                {renderTextWithTerms(text, searchTerms, segmentKey, isFirstMatchTracker)}
              </Fragment>
            );
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
              {renderTextWithTerms(text, searchTerms, segmentKey, isFirstMatchTracker)}
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
      {isLongTranscription && !isExpanded && !shouldAutoExpand && (
        <button
          type="button"
          className="btn btn-primary mt-6"
          onClick={() => setIsExpanded(true)}
        >
          Show more
        </button>
      )}
      {user && (
        <p id="annotation-help" className="mt-4 text-xs text-ink-700/60 dark:text-parchment-50/60">
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
