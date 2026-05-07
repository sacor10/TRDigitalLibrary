import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import type { Document } from '@tr/shared';

interface TimelineProps {
  documents: Document[];
}

const TYPE_COLORS: Record<Document['type'], string> = {
  letter: 'fill-sky-500',
  speech: 'fill-accent-500',
  diary: 'fill-emerald-500',
  article: 'fill-purple-500',
  autobiography: 'fill-rose-500',
};

interface Plotted {
  doc: Document;
  ts: number;
  x: number;
  y: number;
}

export function Timeline({ documents }: TimelineProps) {
  const navigate = useNavigate();

  const { plotted, ticks, minTs, maxTs } = useMemo(() => {
    if (documents.length === 0) {
      return { plotted: [] as Plotted[], ticks: [] as number[], minTs: 0, maxTs: 0 };
    }
    const stamps = documents.map((d) => new Date(d.date).getTime());
    const min = Math.min(...stamps);
    const max = Math.max(...stamps);
    const span = Math.max(max - min, 1);

    const lanes = 4;
    const placed: Plotted[] = documents
      .map((doc) => ({ doc, ts: new Date(doc.date).getTime() }))
      .sort((a, b) => a.ts - b.ts)
      .map((entry, i) => ({
        ...entry,
        x: ((entry.ts - min) / span) * 100,
        y: (i % lanes) * 22 + 18,
      }));

    const minYear = new Date(min).getUTCFullYear();
    const maxYear = new Date(max).getUTCFullYear();
    const tickYears: number[] = [];
    const step = Math.max(Math.ceil((maxYear - minYear) / 5), 1);
    for (let y = minYear; y <= maxYear; y += step) {
      tickYears.push(y);
    }
    if (tickYears[tickYears.length - 1] !== maxYear) tickYears.push(maxYear);

    return { plotted: placed, ticks: tickYears, minTs: min, maxTs: max };
  }, [documents]);

  if (plotted.length === 0) {
    return <p className="py-12 text-center">No documents to plot.</p>;
  }

  const span = Math.max(maxTs - minTs, 1);

  return (
    <figure className="card overflow-x-auto">
      <figcaption className="sr-only">
        Timeline of {plotted.length} documents. Use Tab to focus a marker and Enter to open it.
      </figcaption>
      <svg
        viewBox="0 0 100 110"
        preserveAspectRatio="none"
        className="w-full h-72"
        aria-label="Document timeline"
        role="group"
      >
        <line x1="0" x2="100" y1="105" y2="105" className="stroke-ink-700/30 dark:stroke-parchment-50/30" strokeWidth="0.2" />
        {ticks.map((year) => {
          const ts = Date.UTC(year, 0, 1);
          const x = ((ts - minTs) / span) * 100;
          return (
            <g key={year}>
              <line x1={x} x2={x} y1="103" y2="107" className="stroke-ink-700/40 dark:stroke-parchment-50/40" strokeWidth="0.2" />
              <text
                x={x}
                y="110"
                textAnchor="middle"
                className="fill-ink-700 dark:fill-parchment-100"
                style={{ fontSize: '3px' }}
              >
                {year}
              </text>
            </g>
          );
        })}
        {plotted.map(({ doc, x, y }) => (
          <g key={doc.id} className="cursor-pointer">
            <title>{`${doc.title} (${doc.date})`}</title>
            <line x1={x} x2={x} y1={y + 1.5} y2="105" className="stroke-ink-700/15 dark:stroke-parchment-50/15" strokeWidth="0.15" />
            <circle
              cx={x}
              cy={y}
              r="1.6"
              className={TYPE_COLORS[doc.type]}
              tabIndex={0}
              role="button"
              aria-label={`${doc.title}, ${doc.date}`}
              onClick={() => navigate(`/documents/${doc.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/documents/${doc.id}`);
                }
              }}
            />
          </g>
        ))}
      </svg>
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        {(Object.entries(TYPE_COLORS) as [Document['type'], string][]).map(([type, color]) => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <circle cx="5" cy="5" r="4" className={color} />
            </svg>
            {type}
          </span>
        ))}
      </div>
    </figure>
  );
}
