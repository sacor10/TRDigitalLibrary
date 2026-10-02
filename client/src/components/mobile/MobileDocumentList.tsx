import type { Document } from '@tr/shared';
import { type KeyboardEvent, Fragment, useMemo } from 'react';

import { MobileDocumentCard } from './MobileDocumentCard';

interface MobileDocumentListProps {
  documents: Document[];
  /** Group cards under sticky year headers (used when sorted by date). */
  groupByYear?: boolean;
  /** Tailwind `top-*` class for the sticky year headers (clears fixed bars). */
  headerTopClass?: string;
}

function handleArrowNav(event: KeyboardEvent<HTMLUListElement>): void {
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
}

export function MobileDocumentList({
  documents,
  groupByYear = false,
  headerTopClass = 'top-12',
}: MobileDocumentListProps) {
  const groups = useMemo(() => {
    if (!groupByYear) return null;
    const map: Array<{ year: string; items: Document[] }> = [];
    for (const doc of documents) {
      const year = (doc.date || '').slice(0, 4) || 'Undated';
      const last = map[map.length - 1];
      if (last && last.year === year) last.items.push(doc);
      else map.push({ year, items: [doc] });
    }
    return map;
  }, [documents, groupByYear]);

  if (documents.length === 0) {
    return (
      <p className="py-12 text-center text-ink-700/80 dark:text-parchment-100/80">
        No documents match these filters.
      </p>
    );
  }

  if (groups) {
    return (
      <ul className="grid gap-2" onKeyDown={handleArrowNav}>
        {groups.map((group) => (
          <Fragment key={group.year}>
            <li className={`sticky-header ${headerTopClass}`} aria-hidden="true">
              {group.year}
            </li>
            {group.items.map((doc) => (
              <MobileDocumentCard key={doc.id} document={doc} />
            ))}
          </Fragment>
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid gap-2" onKeyDown={handleArrowNav}>
      {documents.map((doc) => (
        <MobileDocumentCard key={doc.id} document={doc} />
      ))}
    </ul>
  );
}
