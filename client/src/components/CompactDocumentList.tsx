import type { Document, DocumentType } from '@tr/shared';
import type { KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';

const TYPE_LABEL: Record<DocumentType, string> = {
  letter: 'Letter',
  speech: 'Speech',
  diary: 'Diary',
  article: 'Memoir / Article',
  autobiography: 'Autobiography',
  manuscript: 'Manuscript',
};

interface CompactDocumentListProps {
  documents: Document[];
}

/**
 * Dense "index" view: one row per document (title · date · type · recipient),
 * no snippet body. Used by the results view toggle on Search and Browse.
 */
export function CompactDocumentList({ documents }: CompactDocumentListProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const active = document.activeElement;
    const currentIndex = links.findIndex((link) => link === active);
    const nextIndex =
      event.key === 'ArrowDown'
        ? Math.min((currentIndex < 0 ? 0 : currentIndex) + 1, links.length - 1)
        : Math.max((currentIndex < 0 ? links.length : currentIndex) - 1, 0);
    links[nextIndex]?.focus();
    event.preventDefault();
  };

  return (
    <ul
      className="divide-y divide-ink-700/10 rounded-md border border-ink-700/10 dark:divide-parchment-50/10 dark:border-parchment-50/10"
      onKeyDown={handleKeyDown}
    >
      {documents.map((doc) => (
        <li key={doc.id}>
          <Link
            to={`/documents/${doc.id}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 hover:bg-parchment-200/50 dark:hover:bg-ink-700/60"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{doc.title}</span>
            <span className="text-sm text-ink-700/80 dark:text-parchment-100/70">{doc.date}</span>
            <span className="chip text-[10px] whitespace-nowrap">{TYPE_LABEL[doc.type]}</span>
            {doc.recipient && (
              <span className="w-full truncate text-xs text-ink-700/70 dark:text-parchment-100/60 sm:w-auto">
                To {doc.recipient}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
