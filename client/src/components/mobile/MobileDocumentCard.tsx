import type { Document } from '@tr/shared';
import { Link } from 'react-router-dom';

import { sanitizeSnippet, TYPE_LABEL } from '../../lib/documentDisplay';
import { SearchResultPreview } from '../SearchResultPreview';

import { DocumentThumbnail } from './DocumentThumbnail';

interface MobileDocumentCardProps {
  document: Document;
  /** Optional search snippet (may contain <mark> tags). */
  snippet?: string;
  searchQuery?: string;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onClose?: () => void;
}

/** Scannable mobile card: thumbnail + title + meta + type chip (+ optional snippet + preview). */
export function MobileDocumentCard({
  document,
  snippet,
  searchQuery = '',
  isExpanded = false,
  onToggleExpand,
  onClose,
}: MobileDocumentCardProps) {
  const params = new URLSearchParams();
  if (searchQuery.trim()) {
    params.set('q', searchQuery.trim());
  }
  const qs = params.toString();
  const docUrl = `/documents/${document.id}${qs ? `?${qs}` : ''}`;

  return (
    <li
      className={`rounded-xl border border-ink-700/10 bg-white/70 p-3 transition-shadow dark:border-parchment-50/10 dark:bg-ink-800/60 ${
        isExpanded ? 'ring-1 ring-accent-500/50' : ''
      }`}
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            onToggleExpand?.();
          }
        }
      }}
    >
      <div className="flex gap-3">
        <DocumentThumbnail document={document} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug">
            <Link
              to={docUrl}
              onClick={(e) => e.stopPropagation()}
              className="hover:underline focus:outline-none"
            >
              {document.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-ink-700/80 dark:text-parchment-100/70">
            {document.date}
            {document.recipient && <> &middot; To {document.recipient}</>}
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="chip text-[10px]">{TYPE_LABEL[document.type]}</span>
            <span className="text-[11px] font-medium text-accent-600 dark:text-accent-400 select-none">
              {isExpanded ? 'Hide preview ▲' : 'Quick preview ▼'}
            </span>
          </div>
          {snippet && (
            <p
              className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-800/90 dark:text-parchment-100/80"
              dangerouslySetInnerHTML={{ __html: sanitizeSnippet(snippet) }}
            />
          )}
        </div>
      </div>
      {isExpanded && (
        <SearchResultPreview
          documentId={document.id}
          searchQuery={searchQuery}
          snippet={snippet}
          initialDocument={document}
          onClose={onClose}
        />
      )}
    </li>
  );
}
