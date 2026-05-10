import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import type {
  SentimentBin,
  SentimentExtremeItem,
  SentimentTimelinePoint,
} from '@tr/shared';

import { fetchSentimentExtremes, fetchSentimentTimeline } from '../api/client';

const CHART_W = 720;
const CHART_H = 260;

const DEFAULT_FROM = '1912-01-01';
const DEFAULT_TO = '1912-12-31';

function formatPolarity(value: number): string {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function MoodChart({
  points,
  bin,
}: {
  points: SentimentTimelinePoint[];
  bin: SentimentBin;
}) {
  if (points.length === 0) {
    return (
      <p className="text-ink-700/70 dark:text-parchment-100/70">
        No sentiment data for this date range.
      </p>
    );
  }
  const padding = { top: 16, right: 16, bottom: 32, left: 44 };
  const innerW = CHART_W - padding.left - padding.right;
  const innerH = CHART_H - padding.top - padding.bottom;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const yMin = -1;
  const yMax = 1;
  const yToPx = (v: number) =>
    padding.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const linePath = points
    .map((p, i) => {
      const x = padding.left + i * stepX;
      const y = yToPx(p.meanPolarity);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const yTicks = [-1, -0.5, 0, 0.5, 1];
  const xTickEvery = Math.max(1, Math.ceil(points.length / 12));
  const zeroY = yToPx(0);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label={`TR's mood across ${points[0]!.period} to ${points[points.length - 1]!.period}, binned by ${bin}`}
      className="text-accent-500"
    >
      {yTicks.map((tv) => {
        const y = yToPx(tv);
        return (
          <g key={tv}>
            <line
              x1={padding.left}
              x2={padding.left + innerW}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity={tv === 0 ? 0.4 : 0.12}
              strokeDasharray={tv === 0 ? undefined : '3 3'}
            />
            <text
              x={padding.left - 6}
              y={y + 4}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {formatPolarity(tv)}
            </text>
          </g>
        );
      })}
      <line
        x1={padding.left}
        x2={padding.left + innerW}
        y1={zeroY}
        y2={zeroY}
        stroke="currentColor"
        strokeOpacity={0.4}
      />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2} />
      {points.map((p, i) => {
        const x = padding.left + i * stepX;
        const y = yToPx(p.meanPolarity);
        const fill = p.meanPolarity >= 0 ? 'currentColor' : 'rgb(220 38 38)';
        return (
          <circle key={p.period} cx={x} cy={y} r={3} fill={fill}>
            <title>
              {p.period}: {formatPolarity(p.meanPolarity)} ({p.documentCount}{' '}
              {p.documentCount === 1 ? 'doc' : 'docs'})
            </title>
          </circle>
        );
      })}
      {points.map((p, i) =>
        i % xTickEvery === 0 || i === points.length - 1 ? (
          <text
            key={`x-${p.period}`}
            x={padding.left + i * stepX}
            y={CHART_H - padding.bottom + 16}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            fillOpacity={0.7}
          >
            {p.period}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function ExtremeList({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: SentimentExtremeItem[];
  emptyHint: string;
}) {
  return (
    <section>
      <h2 className="uppercase tracking-wide text-xs text-ink-700/70 dark:text-parchment-100/70 mb-3">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="text-ink-700/70 dark:text-parchment-100/70 text-sm">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.documentId} className="flex items-baseline gap-3">
              <span className="text-xs tabular-nums w-14 text-ink-700/70 dark:text-parchment-100/70">
                {formatPolarity(item.polarity)}
              </span>
              <Link
                to={`/documents/${encodeURIComponent(item.documentId)}`}
                className="underline decoration-accent-500/50 hover:decoration-accent-500 truncate"
              >
                {item.title}
              </Link>
              <span className="text-ink-700/70 dark:text-parchment-100/70 text-sm">
                {item.date}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SentimentPage() {
  const [from, setFrom] = useState<string>(DEFAULT_FROM);
  const [to, setTo] = useState<string>(DEFAULT_TO);
  const [bin, setBin] = useState<SentimentBin>('month');

  const timelineQuery = useQuery({
    queryKey: ['sentiment-timeline', from, to, bin],
    queryFn: () => fetchSentimentTimeline({ from, to, bin }),
  });
  const extremesQuery = useQuery({
    queryKey: ['sentiment-extremes', from, to],
    queryFn: () => fetchSentimentExtremes({ from, to, limit: 5 }),
  });

  const isLoading = timelineQuery.isLoading || extremesQuery.isLoading;
  const error = timelineQuery.error ?? extremesQuery.error;
  const points = timelineQuery.data?.points ?? [];
  const extremes = extremesQuery.data;

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">Sentiment</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Per-document polarity scored by VADER (lexicon-based, sentence-level
          length-weighted compound). The default range traces TR&rsquo;s mood across the 1912
          campaign. Each polarity is in <code className="text-xs">[-1, +1]</code>; values near
          zero are neutral.
        </p>
      </header>

      <form
        className="flex flex-wrap items-end gap-4 mb-6"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Sentiment date range"
      >
        <label className="flex flex-col text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 px-2 py-1 rounded border border-ink-700/15 dark:border-parchment-50/15 bg-parchment-50 dark:bg-ink-800 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 px-2 py-1 rounded border border-ink-700/15 dark:border-parchment-50/15 bg-parchment-50 dark:bg-ink-800 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          Bin
          <select
            value={bin}
            onChange={(e) => setBin(e.target.value as SentimentBin)}
            className="mt-1 px-2 py-1 rounded border border-ink-700/15 dark:border-parchment-50/15 bg-parchment-50 dark:bg-ink-800 text-sm normal-case tracking-normal"
          >
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setFrom(DEFAULT_FROM);
            setTo(DEFAULT_TO);
            setBin('month');
          }}
        >
          Reset to 1912
        </button>
      </form>

      {isLoading && <p>Loading&hellip;</p>}
      {error && (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load sentiment.'}
        </p>
      )}

      {!isLoading && !error && (
        <>
          <section className="mb-10">
            <h2 className="uppercase tracking-wide text-xs text-ink-700/70 dark:text-parchment-100/70 mb-3">
              TR&rsquo;s mood across {from} &ndash; {to}
            </h2>
            {points.length === 0 ? (
              <div className="rounded-md border border-ink-700/10 dark:border-parchment-50/10 bg-parchment-50/40 dark:bg-ink-800/40 p-6 text-sm">
                <p>
                  No sentiment data for this range. Run{' '}
                  <code className="px-1 py-0.5 rounded bg-parchment-200/60 dark:bg-ink-700">
                    npm run sentiment
                  </code>{' '}
                  to compute scores, or widen the date filter.
                </p>
                <p className="mt-2 text-ink-700/70 dark:text-parchment-100/70">
                  The 8-document POC corpus covers 1899&ndash;1910, so the 1912 default range is
                  empty until the full Morison corpus is loaded.
                </p>
              </div>
            ) : (
              <MoodChart points={points} bin={bin} />
            )}
          </section>

          {extremes && (extremes.mostPositive.length > 0 || extremes.mostNegative.length > 0) && (
            <div className="grid gap-8 md:grid-cols-2">
              <ExtremeList
                title="Most positive"
                items={extremes.mostPositive}
                emptyHint="No positive documents in this range."
              />
              <ExtremeList
                title="Most negative"
                items={extremes.mostNegative}
                emptyHint="No negative documents in this range."
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
