import {
  EARLIEST_ROOSEVELT_DOCUMENT_DATE,
  clampRooseveltDocumentDate,
  type Document,
} from '@tr/shared';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';


interface TimelineProps {
  documents: Document[];
  dateFrom?: string;
  dateTo?: string;
  selectedDocumentId?: string | null;
  onDateRangeChange?: (range: {
    dateFrom: string;
    dateTo: string;
    selectedDocumentId: string;
  }) => void;
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

interface Tick {
  key: string;
  label: string;
  ts: number;
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
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

function chooseTickStep(yearSpan: number): number {
  if (yearSpan <= 5) return 1;
  if (yearSpan <= 12) return 2;
  if (yearSpan <= 30) return 5;
  if (yearSpan <= 60) return 10;
  return 20;
}

function parseIsoDate(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

function formatIsoDate(ts: number): string {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addUtcMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  const target = new Date(Date.UTC(year, month + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const targetDay = Math.min(day, daysInUtcMonth(targetYear, targetMonth));
  return formatIsoDate(Date.UTC(targetYear, targetMonth, targetDay));
}

function centeredSixMonthRange(date: string): { dateFrom: string; dateTo: string } {
  return {
    dateFrom: clampRooseveltDocumentDate(addUtcMonths(date, -3)),
    dateTo: addUtcMonths(date, 3),
  };
}

function isRangeAtLeastSixMonths(dateFrom?: string, dateTo?: string): boolean {
  if (!dateFrom || !dateTo) return true;
  return addUtcMonths(dateFrom, 6) <= dateTo;
}

function buildYearTicks(minYear: number, maxYear: number): Tick[] {
  const step = chooseTickStep(maxYear - minYear);
  const ticks: Tick[] = [];
  for (let y = minYear; y <= maxYear; y += step) {
    ticks.push({ key: `year-${y}`, label: String(y), ts: Date.UTC(y, 0, 1) });
  }
  if (ticks[ticks.length - 1]?.label !== String(maxYear)) {
    ticks.push({ key: `year-${maxYear}`, label: String(maxYear), ts: Date.UTC(maxYear, 0, 1) });
  }
  return ticks;
}

function buildMonthTicks(minTs: number, maxTs: number): Tick[] {
  const ticks: Tick[] = [
    {
      key: `range-start-${minTs}`,
      label: MONTH_FORMATTER.format(new Date(minTs)),
      ts: minTs,
    },
  ];
  const start = new Date(minTs);
  let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);

  while (cursor <= maxTs) {
    ticks.push({
      key: `month-${cursor}`,
      label: MONTH_FORMATTER.format(new Date(cursor)),
      ts: cursor,
    });
    const d = new Date(cursor);
    cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }

  return ticks;
}

export function Timeline({
  documents,
  dateFrom,
  dateTo,
  selectedDocumentId,
  onDateRangeChange,
}: TimelineProps) {
  const navigate = useNavigate();

  const { plotted, ticks, minTs, maxTs } = useMemo(() => {
    if (documents.length === 0) {
      return { plotted: [] as Plotted[], ticks: [] as Tick[], minTs: 0, maxTs: 0 };
    }
    const stamps = documents.map((d) => new Date(d.date).getTime());
    const minDataTs = Math.min(...stamps);
    const maxDataTs = Math.max(...stamps);

    const minYear = new Date(minDataTs).getUTCFullYear();
    const maxYear = new Date(maxDataTs).getUTCFullYear();
    const hasExplicitRange = Boolean(dateFrom || dateTo);
    let min = dateFrom ? parseIsoDate(dateFrom) : Date.UTC(minYear, 0, 1);
    let max = dateTo ? parseIsoDate(dateTo) : Date.UTC(maxYear + 1, 0, 1);

    if (min < parseIsoDate(EARLIEST_ROOSEVELT_DOCUMENT_DATE)) {
      min = parseIsoDate(EARLIEST_ROOSEVELT_DOCUMENT_DATE);
    }
    if (max <= min) {
      max = min + DAY_MS;
    }

    const span = max - min;

    const sorted = documents
      .map((doc) => ({ doc, ts: new Date(doc.date).getTime() }))
      .filter(({ ts }) => ts >= min && ts <= max)
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

    const yearSpan = (max - min) / (365.2425 * DAY_MS);
    const rangeMinYear = new Date(min).getUTCFullYear();
    const rangeMaxYear = new Date(max).getUTCFullYear();
    const tickMarks =
      hasExplicitRange && yearSpan < 1
        ? buildMonthTicks(min, max)
        : buildYearTicks(
            hasExplicitRange ? rangeMinYear : minYear,
            hasExplicitRange ? rangeMaxYear : maxYear,
          );

    return { plotted: placed, ticks: tickMarks, minTs: min, maxTs: max };
  }, [dateFrom, dateTo, documents]);

  const openDocument = (doc: Document): void => {
    navigate(`/documents/${doc.id}`);
  };

  const activateMarker = (doc: Document): void => {
    if (doc.id === selectedDocumentId) {
      openDocument(doc);
      return;
    }
    if (onDateRangeChange && isRangeAtLeastSixMonths(dateFrom, dateTo)) {
      onDateRangeChange({ ...centeredSixMonthRange(doc.date), selectedDocumentId: doc.id });
      return;
    }
    openDocument(doc);
  };

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
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto min-w-[48rem] sm:min-w-0 sm:w-full"
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
            const x = MARGIN.left + ((year.ts - minTs) / span) * PLOT_W;
            return (
              <g key={year.key}>
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
                  {year.label}
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
                className={`${TYPE_COLORS[doc.type]} ${
                  selectedDocumentId === doc.id
                    ? 'stroke-ink-900 dark:stroke-parchment-50'
                    : 'stroke-transparent'
                } transition-opacity hover:opacity-80`}
                strokeWidth={selectedDocumentId === doc.id ? 3 : 0}
                tabIndex={0}
                role="button"
                aria-label={`${doc.title}, ${doc.date}`}
                aria-pressed={selectedDocumentId === doc.id}
                onClick={() => activateMarker(doc)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activateMarker(doc);
                  }
                }}
              />
            </g>
          ))}
        </svg>
      </div>
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
