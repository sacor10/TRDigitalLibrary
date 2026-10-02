import type { Document } from '@tr/shared';
import { Link } from 'react-router-dom';

import { sanitizeSnippet, TYPE_LABEL } from '../../lib/documentDisplay';

import { DocumentThumbnail } from './DocumentThumbnail';

interface MobileDocumentCardProps {
  document: Document;
  /** Optional search snippet (may contain <mark> tags). */
  snippet?: string;
}

/** Scannable mobile card: thumbnail + title + meta + type chip (+ optional snippet). */
export function MobileDocumentCard({ document, snippet }: MobileDocumentCardProps) {
  return (
    <li>
      <Link
        to={`/documents/${document.id}`}
        className="tap flex gap-3 rounded-xl border border-ink-700/10 bg-white/70 p-3 active:bg-parchment-200/40 dark:border-parchment-50/10 dark:bg-ink-800/60 dark:active:bg-ink-700/60"
      >
        <DocumentThumbnail document={document} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug">{document.title}</h3>
          <p className="mt-0.5 truncate text-sm text-ink-700/80 dark:text-parchment-100/70">
            {document.date}
            {document.recipient && <> &middot; To {document.recipient}</>}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="chip text-[10px]">{TYPE_LABEL[document.type]}</span>
          </div>
          {snippet && (
            <p
              className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-800/90 dark:text-parchment-100/80"
              dangerouslySetInnerHTML={{ __html: sanitizeSnippet(snippet) }}
            />
          )}
        </div>
      </Link>
    </li>
  );
}
