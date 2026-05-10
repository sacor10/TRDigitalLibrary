import { Link } from 'react-router-dom';

import type { Document } from '@tr/shared';

const TYPE_LABEL: Record<Document['type'], string> = {
  letter: 'Letter',
  speech: 'Speech',
  diary: 'Diary',
  article: 'Memoir / Article',
  autobiography: 'Autobiography',
  manuscript: 'Manuscript',
};

interface DocumentListProps {
  documents: Document[];
}

export function DocumentList({ documents }: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <p className="py-12 text-center text-ink-700/80 dark:text-parchment-100/80">
        No documents match these filters.
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {documents.map((doc) => (
        <li key={doc.id} className="card hover:shadow-md transition-shadow">
          <Link to={`/documents/${doc.id}`} className="block">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-lg leading-tight">{doc.title}</h3>
                <p className="mt-1 text-sm text-ink-700 dark:text-parchment-100">
                  {doc.date}
                  {doc.location && <> &middot; {doc.location}</>}
                  {doc.recipient && <> &middot; To {doc.recipient}</>}
                </p>
              </div>
              <span className="chip w-fit whitespace-nowrap">{TYPE_LABEL[doc.type]}</span>
            </div>
            {doc.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {doc.tags.slice(0, 5).map((t) => (
                  <span key={t} className="chip text-[10px]">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
