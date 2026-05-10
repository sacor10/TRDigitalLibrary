import type { Document } from '@tr/shared';

import { documentExportUrl, type ExportFormat } from '../api/client';

interface ExportPanelProps {
  document: Document;
}

const FORMATS: { id: ExportFormat; label: string; description: string }[] = [
  { id: 'pdf', label: 'PDF', description: 'Typeset for reading and print.' },
  { id: 'epub', label: 'EPUB', description: 'For e-readers (Apple Books, Kindle, Calibre).' },
  { id: 'tei', label: 'TEI XML', description: 'P5-shaped scholarly source.' },
];

export function ExportPanel({ document }: ExportPanelProps) {
  return (
    <section aria-labelledby="export-heading" className="card">
      <h3 id="export-heading" className="text-sm font-semibold uppercase tracking-wide">
        Export
      </h3>
      <p className="mt-2 text-xs text-ink-700/70 dark:text-parchment-100/70">
        Download this document for offline reading or scholarly reuse.
      </p>
      <ul className="mt-3 space-y-2">
        {FORMATS.map((f) => (
          <li key={f.id}>
            <a
              className="btn w-full flex-col items-start text-left sm:flex-row sm:items-center sm:justify-between"
              href={documentExportUrl(document.id, f.id)}
              download
              aria-label={`Download ${document.title} as ${f.label}`}
            >
              <span>{f.label}</span>
              <span className="text-xs text-ink-700/60 dark:text-parchment-100/60">
                {f.description}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
