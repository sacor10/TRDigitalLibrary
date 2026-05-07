import type { Document } from '@tr/shared';

import { CitationGenerator } from './CitationGenerator';

interface MetadataSidebarProps {
  document: Document;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

const TYPE_LABEL: Record<Document['type'], string> = {
  letter: 'Letter',
  speech: 'Speech',
  diary: 'Diary entry',
  article: 'Article / Memoir',
  autobiography: 'Autobiography',
};

export function MetadataSidebar({ document }: MetadataSidebarProps) {
  return (
    <aside aria-label="Document metadata" className="space-y-4">
      <section className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Metadata</h2>
        <dl className="mt-3 space-y-3">
          <Field label="Type" value={TYPE_LABEL[document.type]} />
          <Field label="Date" value={document.date} />
          <Field label="Author" value={document.author} />
          <Field label="Recipient" value={document.recipient} />
          <Field label="Location" value={document.location} />
          <Field label="Provenance" value={document.provenance} />
          <Field label="Source" value={document.source} />
          {document.sourceUrl && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
                Source URL
              </dt>
              <dd className="mt-0.5 text-sm break-all">
                <a
                  href={document.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-accent-600 dark:text-accent-500"
                >
                  {document.sourceUrl}
                </a>
              </dd>
            </div>
          )}
          {document.tags.length > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
                Tags
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {document.tags.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </section>
      <CitationGenerator document={document} />
    </aside>
  );
}
