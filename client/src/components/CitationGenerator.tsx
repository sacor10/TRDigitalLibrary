import { useState } from 'react';

import type { Document } from '@tr/shared';

type Style = 'chicago' | 'mla' | 'apa';

const STYLES: { id: Style; label: string }[] = [
  { id: 'chicago', label: 'Chicago' },
  { id: 'mla', label: 'MLA' },
  { id: 'apa', label: 'APA' },
];

function year(date: string): string {
  return date.slice(0, 4);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildCitation(doc: Document, style: Style): string {
  const author = doc.author;
  const title = doc.title;
  const dateYear = year(doc.date);
  const fullDate = doc.date;
  const source = doc.source;
  const url = doc.sourceUrl ?? '';
  const accessed = todayISO();

  switch (style) {
    case 'chicago':
      return `${author}. "${title}." ${fullDate}. ${source}. ${url ? `${url}. ` : ''}Accessed ${accessed}.`;
    case 'mla':
      return `${author}. "${title}." ${source}, ${fullDate}, ${url}. Accessed ${accessed}.`;
    case 'apa':
      return `${author}. (${dateYear}, ${fullDate}). ${title}. ${source}. ${url}`;
    default:
      return '';
  }
}

interface CitationGeneratorProps {
  document: Document;
}

export function CitationGenerator({ document }: CitationGeneratorProps) {
  const [style, setStyle] = useState<Style>('chicago');
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
      <div role="radiogroup" aria-label="Citation style" className="mt-3 flex gap-1">
        {STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={style === s.id}
            onClick={() => setStyle(s.id)}
            className={`px-3 py-1 text-xs rounded ${
              style === s.id ? 'bg-accent-500 text-white' : 'bg-parchment-200/60 dark:bg-ink-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm font-sans bg-parchment-100/70 dark:bg-ink-900/60 p-3 rounded leading-relaxed">
        {citation}
      </p>
      <button type="button" className="btn mt-3" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy citation'}
      </button>
    </section>
  );
}
