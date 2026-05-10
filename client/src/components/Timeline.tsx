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
  manuscript: 'fill-amber-500',
};

interface Plotted {
  doc: Document;
  ts: number;
  x: number;
  y: number;
}

const WIDTH = 1200;
const HEIGHT = 280;
const MARGIN = { top: 24, right: 40, bottom: 44, left: 40 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const LANES = 4;
const LANE_TOP = MARGIN.top + 8;
const LANE_GAP = (PLOT_H - 16) / LANES;
const MARKER_R = 7;
const MIN_SPACING = MARKER_R * 2 + 4;

function chooseTickStep(yearSpan: number): number {
  if (yearSpan <= 5) return 1;
  if (yearSpan <= 12) return 2;
  if (yearSpan <= 30) return 5;
  if (yearSpan <= 60) return 10;
  return 20;
}

export function Timeline({ documents }: TimelineProps) {
  const navigate = useNavigate();

  const { plotted, ticks, minTs, maxTs } = useMemo(() => {
    if (documents.length === 0) {
      return { plotted: [] as Plotted[], ticks: [] as number[], minTs: 0, maxTs: 0 };
    }
    const stamps = documents.map((d) => new Date(d.date).getTime());
    const minDataTs = Math.min(...stamps);
    const maxDataTs = Math.max(...stamps);

    // Anchor the domain to whole-year boundaries so ticks align nicely
    // and edge markers don't sit on the axis edge.
    const minYear = new Date(minDataTs).getUTCFullYear();
    const maxYear = new Date(maxDataTs).getUTCFullYear();
    const min = Date.UTC(minYear, 0, 1);
    const max = Date.UTC(maxYear + 1, 0, 1);
    const span = max - min;

    const sorted = documents
      .map((doc) => ({ doc, ts: new Date(doc.date).getTime() }))
      .sort((a, b) => a.ts - b.ts);

    // Lane assignment that prefers higher (lower-index) lanes and only drops
    // down when the previous marker on that lane is too close horizontally.
    const laneLastX: number[] = new Array(LANES).fill(-Infinity);
    const placed: Plotted[] = sorted.map(({ doc, ts }) => {
      const x = MARGIN.left + ((ts - min) / span) * PLOT_W;
      let lane = LANES - 1;
      for (let l = 0; l < LANES; l++) {
        if (x - (laneLastX[l] ?? -Infinity) >= MIN_SPACING) {
          lane = l;
          break;
        }
      }
      laneLastX[lane] = x;
      return { doc, ts, x, y: LANE_TOP + lane * LANE_GAP };
    });

    const step = chooseTickStep(maxYear - minYear);
    const tickYears: number[] = [];
    for (let y = minYear; y <= maxYear; y += step) tickYears.push(y);
    if (tickYears[tickYears.length - 1] !== maxYear) tickYears.push(maxYear);

    return { plotted: placed, ticks: tickYears, minTs: min, maxTs: max };
  }, [documents]);

  if (plotted.length === 0) {
    return <p className="py-12 text-center">No documents to plot.</p>;
  }

  const span = Math.max(maxTs - minTs, 1);
  const axisY = MARGIN.top + PLOT_H;

  return (
    <figure className="card">
      <figcaption className="sr-only">
        Timeline of {plotted.length} documents. Use Tab to focus a marker and Enter to open it.
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        aria-label="Document timeline"
        role="group"
      >
        <line
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={axisY}
          y2={axisY}
          className="stroke-ink-700/30 dark:stroke-parchment-50/30"
          strokeWidth="1"
        />
        {ticks.map((year) => {
          const ts = Date.UTC(year, 0, 1);
          const x = MARGIN.left + ((ts - minTs) / span) * PLOT_W;
          return (
            <g key={year}>
              <line
                x1={x}
                x2={x}
                y1={axisY - 4}
                y2={axisY + 4}
                className="stroke-ink-700/40 dark:stroke-parchment-50/40"
                strokeWidth="1"
              />
              <text
                x={x}
                y={axisY + 22}
                textAnchor="middle"
                className="fill-ink-700 dark:fill-parchment-100"
                style={{ fontSize: '14px' }}
              >
                {year}
              </text>
            </g>
          );
        })}
        {plotted.map(({ doc, x, y }) => (
          <g key={doc.id} className="cursor-pointer">
            <title>{`${doc.title} (${doc.date})`}</title>
            <line
              x1={x}
              x2={x}
              y1={y + MARKER_R}
              y2={axisY}
              className="stroke-ink-700/25 dark:stroke-parchment-50/25"
              strokeWidth="1"
            />
            <circle
              cx={x}
              cy={y}
              r={MARKER_R}
              className={`${TYPE_COLORS[doc.type]} transition-opacity hover:opacity-80`}
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
