import type { SearchResult } from '@tr/shared';
import { useState, type KeyboardEvent } from 'react';

import { MobileDocumentCard } from './MobileDocumentCard';

interface MobileSearchResultsProps {
  results: SearchResult[];
  searchQuery?: string;
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

export function MobileSearchResults({ results, searchQuery = '' }: MobileSearchResultsProps) {
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  const toggleExpand = (docId: string) => {
    setExpandedDocId((current) => (current === docId ? null : docId));
  };

  return (
    <ul className="grid gap-2" onKeyDown={handleArrowNav}>
      {results.map(({ document, snippet }) => (
        <MobileDocumentCard
          key={document.id}
          document={document}
          snippet={snippet}
          searchQuery={searchQuery}
          isExpanded={expandedDocId === document.id}
          onToggleExpand={() => toggleExpand(document.id)}
          onClose={() => setExpandedDocId(null)}
        />
      ))}
    </ul>
  );
}
