import { useQuery } from '@tanstack/react-query';
import type { Document } from '@tr/shared';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { fetchDocument } from '../api/client';
import { sanitizeSnippet } from '../lib/documentDisplay';

interface SearchResultPreviewProps {
  documentId: string;
  searchQuery: string;
  snippet?: string | undefined;
  initialDocument?: Document | undefined;
  onClose?: (() => void) | undefined;
}

function extractKeywords(rawQuery: string): string[] {
  // Strip structured query terms like type:letter, date:1900, etc.
  const stripped = rawQuery.replace(/[A-Za-z]+:[^\s]+/g, ' ');
  return stripped
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter((w) => w.length > 0);
}

function highlightText(text: string, terms: string[]): string {
  if (!text || terms.length === 0) {
    return text;
  }
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

export function SearchResultPreview({
  documentId,
  searchQuery,
  snippet,
  initialDocument,
  onClose,
}: SearchResultPreviewProps) {
  const { data: document, isLoading, error } = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => fetchDocument(documentId),
    initialData: initialDocument?.transcription ? initialDocument : undefined,
    staleTime: 60_000,
  });

  const terms = useMemo(() => extractKeywords(searchQuery), [searchQuery]);

  const viewDocUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    }
    const qs = params.toString();
    return `/documents/${documentId}${qs ? `?${qs}` : ''}`;
  }, [documentId, searchQuery]);

  const transcription = document?.transcription || '';
  const paragraphs = useMemo(
    () =>
      transcription
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    [transcription],
  );

  // Check where the search term appears in the document text
  const matchInfo = useMemo(() => {
    if (!terms.length || !paragraphs.length) {
      return { hasMatch: false, matchingIndices: [] };
    }
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'i');
    const indices: number[] = [];
    paragraphs.forEach((p, idx) => {
      if (regex.test(p)) {
        indices.push(idx);
      }
    });
    return {
      hasMatch: indices.length > 0,
      matchingIndices: indices,
    };
  }, [paragraphs, terms]);

  // Determine which paragraphs to show for the excerpt:
  // If there's a match, center the excerpt window on the first matching paragraph(s).
  // Otherwise, default to the beginning of the document.
  const { excerptParagraphs, isExcerptJumped, hasPreceding, hasFollowing } = useMemo(() => {
    if (paragraphs.length <= 3) {
      return {
        excerptParagraphs: paragraphs,
        isExcerptJumped: false,
        hasPreceding: false,
        hasFollowing: false,
      };
    }
    if (matchInfo.hasMatch) {
      const firstMatchIdx = matchInfo.matchingIndices[0] ?? 0;
      // Start 1 paragraph before the match if possible, and include 3 paragraphs
      const startIdx = Math.max(0, firstMatchIdx - 1);
      const endIdx = Math.min(paragraphs.length, startIdx + 3);
      return {
        excerptParagraphs: paragraphs.slice(startIdx, endIdx),
        isExcerptJumped: startIdx > 0,
        hasPreceding: startIdx > 0,
        hasFollowing: endIdx < paragraphs.length,
      };
    }
    return {
      excerptParagraphs: paragraphs.slice(0, 3),
      isExcerptJumped: false,
      hasPreceding: false,
      hasFollowing: paragraphs.length > 3,
    };
  }, [matchInfo, paragraphs]);

  // Check whether metadata matched (title, tags/topics, recipient, etc.)
  const metadataMatches = useMemo(() => {
    if (!terms.length || !document) return [];
    const matchedMetadata: string[] = [];
    const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escaped.join('|')})`, 'i');

    if (regex.test(document.title)) {
      matchedMetadata.push('Title');
    }
    if (document.recipient && regex.test(document.recipient)) {
      matchedMetadata.push(`Recipient (${document.recipient})`);
    }
    const matchedTags = (document.tags || []).filter((tag) => regex.test(tag));
    if (matchedTags.length > 0) {
      matchedMetadata.push(`Topic/Tag: ${matchedTags.join(', ')}`);
    }
    return matchedMetadata;
  }, [document, terms]);

  if (isLoading) {
    return (
      <div className="mt-3 rounded-lg border border-ink-700/10 bg-parchment-50/80 p-4 dark:border-parchment-50/10 dark:bg-ink-800/80">
        <div className="flex items-center gap-2 text-sm text-ink-700 dark:text-parchment-100">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
          <span>Loading preview...</span>
        </div>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="mt-3 rounded-lg border border-red-500/20 bg-red-50/50 p-4 dark:bg-red-950/20">
        <p className="text-sm text-red-600 dark:text-red-400">
          Failed to load document preview.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mt-3 rounded-lg border border-ink-700/15 bg-parchment-100/60 p-4 dark:border-parchment-50/15 dark:bg-ink-800/70"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-ink-700/10 pb-2 dark:border-parchment-50/10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-700/70 dark:text-parchment-100/70">
            Document Preview
          </span>
          {isExcerptJumped && (
            <span className="rounded bg-accent-500/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-700 dark:text-accent-300">
              Jumped to match
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to={viewDocUrl}
            className="btn btn-sm btn-primary text-xs"
          >
            View full document &rarr;
          </Link>
          {onClose && (
            <button
              type="button"
              className="text-xs text-ink-700/60 hover:text-ink-900 dark:text-parchment-100/60 dark:hover:text-parchment-100"
              onClick={onClose}
              aria-label="Close preview"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* If matched by metadata/topic rather than transcription body text */}
      {terms.length > 0 && !matchInfo.hasMatch && (
        <div className="mt-3 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          <span className="font-semibold">Matched via metadata: </span>
          {metadataMatches.length > 0
            ? metadataMatches.join('; ')
            : 'Associated topics, collections, or document metadata.'}
          {' '}The searched term does not appear in the transcription body text.
        </div>
      )}

      <div className="mt-3 max-h-60 overflow-y-auto pr-1 text-sm leading-relaxed text-ink-800 dark:text-parchment-100">
        {transcription ? (
          <div className="space-y-2">
            {hasPreceding && (
              <p className="italic text-xs text-ink-700/70 dark:text-parchment-100/70">
                ... earlier text
              </p>
            )}
            {excerptParagraphs.map((para, i) => (
              <p
                key={i}
                dangerouslySetInnerHTML={{
                  __html: sanitizeSnippet(highlightText(para, terms)),
                }}
              />
            ))}
            {hasFollowing && (
              <p className="italic text-xs text-ink-700/70 dark:text-parchment-100/70">
                ... more in full document
              </p>
            )}
          </div>
        ) : (
          <p className="italic text-ink-700/70 dark:text-parchment-100/70">
            No transcription text available for this document.
          </p>
        )}
      </div>
    </div>
  );
}
