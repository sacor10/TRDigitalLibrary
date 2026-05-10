import { useState } from 'react';

import type { Document } from '@tr/shared';

import { buildCitation, type CitationStyle } from '../lib/citation';

const STYLES: { id: CitationStyle; label: string }[] = [
  { id: 'chicago', label: 'Chicago' },
  { id: 'mla', label: 'MLA' },
  { id: 'apa', label: 'APA' },
];

interface CitationGeneratorProps {
  document: Document;
}

export function CitationGenerator({ document }: CitationGeneratorProps) {
  const [style, setStyle] = useState<CitationStyle>('chicago');
  const [copied, setCopied] = useState(false);
  const citation = buildCitation(document, style);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="cite-heading" className="card">
      <h3 id="cite-heading" className="text-sm font-semibold uppercase tracking-wide">
        Cite this document
      </h3>
      <div role="radiogroup" aria-label="Citation style" className="mt-3 flex flex-wrap gap-1">
        {STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={style === s.id}
            onClick={() => setStyle(s.id)}
            className={`min-h-9 rounded px-3 py-1 text-xs ${
              style === s.id ? 'bg-accent-500 text-white' : 'bg-parchment-200/60 dark:bg-ink-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-3 rounded bg-parchment-100/70 p-3 font-sans text-sm leading-relaxed dark:bg-ink-900/60">
        {citation}
      </p>
      <button type="button" className="btn mt-3" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy citation'}
      </button>
    </section>
  );
}
