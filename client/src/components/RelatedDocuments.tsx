import { useQuery } from '@tanstack/react-query';
import type { RelatedReason } from '@tr/shared';
import { Link } from 'react-router-dom';

import { fetchRelatedDocuments } from '../api/client';

const REASON_LABEL: Record<RelatedReason, string> = {
  embedding: 'Similar text',
  'shared-topic': 'Shared topics',
  'same-recipient': 'Same recipient',
  'temporal-proximity': 'Around the same time',
};

/** "See also" block: documents related to the current one. */
export function RelatedDocuments({ documentId }: { documentId: string }) {
  const { data } = useQuery({
    queryKey: ['related', documentId],
    queryFn: () => fetchRelatedDocuments(documentId, 6),
    enabled: documentId.length > 0,
  });

  if (!data || data.items.length === 0) return null;

  return (
    <section className="card">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
        See also
      </h2>
      <ul className="mt-3 grid gap-3">
        {data.items.map(({ document, reasons }) => (
          <li key={document.id}>
            <Link to={`/documents/${document.id}`} className="block hover:underline">
              <span className="font-medium leading-tight">{document.title}</span>
              <span className="ml-2 text-xs text-ink-700/60 dark:text-parchment-100/50">
                {document.date}
              </span>
            </Link>
            {reasons.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {reasons.map((reason) => (
                  <span key={reason} className="chip text-[10px]">
                    {REASON_LABEL[reason]}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
