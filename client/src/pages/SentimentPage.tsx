import { useQuery } from '@tanstack/react-query';
import type { SentimentBin, SentimentExtremeItem, SentimentTimelinePoint } from '@tr/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';


import {
  fetchSentimentExtremes,
  fetchSentimentRange,
  fetchSentimentTimeline,
} from '../api/client';
import { LoadingModal } from '../components/LoadingModal';

const CHART_W = 720;
const CHART_H = 260;
const EXTREMES_PAGE_SIZE = 5;

interface SelectedSentimentPeriod {
  period: string;
  bin: SentimentBin;
  from: string;
  to: string;
}

function formatPolarity(value: number): string {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function periodToDateRange(
  period: string,
  bin: SentimentBin,
  from: string,
  to: string,
): SelectedSentimentPeriod {
  const [yearRaw, monthRaw] = period.split('-');
  const year = Number.parseInt(yearRaw ?? '', 10);
  const month = Number.parseInt(monthRaw ?? '', 10);
  const periodFrom =
    bin === 'year' ? `${period}-01-01` : `${yearRaw}-${String(month).padStart(2, '0')}-01`;
  const periodTo = bin === 'year' ? `${period}-12-31` : lastDayOfMonth(year, month);

  return {
    period,
    bin,
    from: periodFrom < from ? from : periodFrom,
    to: periodTo > to ? to : periodTo,
  };
}

function MoodChart({
  points,
  bin,
  selectedPeriod,
  onTogglePeriod,
}: {
  points: SentimentTimelinePoint[];
  bin: SentimentBin;
  selectedPeriod: string | null;
  onTogglePeriod: (period: string) => void;
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
  const yToPx = (v: number) => padding.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

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
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <svg
        width="100%"
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-label={`TR's mood across ${points[0]!.period} to ${points[points.length - 1]!.period}, binned by ${bin}`}
        className="min-w-[36rem] text-accent-500 sm:min-w-0"
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
          const selected = selectedPeriod === p.period;
          const label = `Show documents for ${p.period}: ${formatPolarity(p.meanPolarity)} (${p.documentCount} ${
            p.documentCount === 1 ? 'doc' : 'docs'
          })`;
          return (
            <g
              key={p.period}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={selected}
              className="cursor-pointer outline-none"
              onClick={() => onTogglePeriod(p.period)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onTogglePeriod(p.period);
              }}
            >
              <circle cx={x} cy={y} r={9} fill="transparent" />
              {selected && (
                <circle
                  cx={x}
                  cy={y}
                  r={6}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                />
              )}
              <circle
                cx={x}
                cy={y}
                r={selected ? 4 : 3}
                fill={fill}
                stroke="currentColor"
                strokeWidth={selected ? 1 : 0}
              >
                <title>
                  {p.period}: {formatPolarity(p.meanPolarity)} ({p.documentCount}{' '}
                  {p.documentCount === 1 ? 'doc' : 'docs'})
                </title>
              </circle>
            </g>
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
    </div>
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
            <li key={item.documentId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="w-14 text-xs tabular-nums text-ink-700/70 dark:text-parchment-100/70">
                {formatPolarity(item.polarity)}
              </span>
              <Link
                to={`/documents/${encodeURIComponent(item.documentId)}`}
                className="min-w-0 underline decoration-accent-500/50 hover:decoration-accent-500"
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
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [bin, setBin] = useState<SentimentBin>('month');
  const [selectedPeriod, setSelectedPeriod] = useState<SelectedSentimentPeriod | null>(null);
  const [positiveOffset, setPositiveOffset] = useState(0);
  const [negativeOffset, setNegativeOffset] = useState(0);
  const [positiveItems, setPositiveItems] = useState<SentimentExtremeItem[]>([]);
  const [negativeItems, setNegativeItems] = useState<SentimentExtremeItem[]>([]);
  const [positiveTotal, setPositiveTotal] = useState(0);
  const [negativeTotal, setNegativeTotal] = useState(0);
  const appliedExtremesRef = useRef('');
  // Once the user touches a filter, never auto-seed again. Lets us land on a
  // populated chart by default without trapping the user inside it.
  const userTouchedDates = useRef(false);

  const rangeQuery = useQuery({
    queryKey: ['sentiment-range'],
    queryFn: () => fetchSentimentRange(),
    staleTime: Infinity,
  });
  const corpusMin = rangeQuery.data?.minDate ?? null;
  const corpusMax = rangeQuery.data?.maxDate ?? null;
  const corpusCount = rangeQuery.data?.count ?? 0;
  const datesReady = from !== null && to !== null;
  const corpusEmpty = rangeQuery.isSuccess && corpusCount === 0;

  const timelineQuery = useQuery({
    queryKey: ['sentiment-timeline', from, to, bin],
    queryFn: () => fetchSentimentTimeline({ from: from!, to: to!, bin }),
    enabled: datesReady,
  });
  const extremesFrom = selectedPeriod?.from ?? from;
  const extremesTo = selectedPeriod?.to ?? to;
  const extremesQuery = useQuery({
    queryKey: [
      'sentiment-extremes',
      extremesFrom,
      extremesTo,
      positiveOffset,
      negativeOffset,
    ],
    queryFn: () =>
      fetchSentimentExtremes({
        from: extremesFrom!,
        to: extremesTo!,
        limit: EXTREMES_PAGE_SIZE,
        positiveOffset,
        negativeOffset,
      }),
    enabled: datesReady,
  });

  useEffect(() => {
    if (userTouchedDates.current) return;
    if (!corpusMin || !corpusMax || corpusCount === 0) return;
    setFrom(corpusMin);
    setTo(corpusMax);
  }, [corpusMin, corpusMax, corpusCount]);

  const isLoading = rangeQuery.isLoading || (datesReady && timelineQuery.isLoading);
  const error = rangeQuery.error ?? timelineQuery.error ?? extremesQuery.error;
  const points = timelineQuery.data?.points ?? [];
  const togglePeriod = (period: string) => {
    if (!from || !to) return;
    setSelectedPeriod((current) =>
      current?.period === period && current.bin === bin
        ? null
        : periodToDateRange(period, bin, from, to),
    );
  };

  useEffect(() => {
    setPositiveOffset(0);
    setNegativeOffset(0);
    setPositiveItems([]);
    setNegativeItems([]);
    setPositiveTotal(0);
    setNegativeTotal(0);
    appliedExtremesRef.current = '';
  }, [extremesFrom, extremesTo]);

  useEffect(() => {
    const data = extremesQuery.data;
    if (!data) return;
    const fingerprint = `${extremesFrom}|${extremesTo}|${data.positiveOffset}|${data.negativeOffset}|${data.positiveTotal}|${data.negativeTotal}|${data.mostPositive.length}|${data.mostNegative.length}`;
    if (appliedExtremesRef.current === fingerprint) return;
    appliedExtremesRef.current = fingerprint;
    setPositiveTotal(data.positiveTotal);
    setNegativeTotal(data.negativeTotal);
    if (data.positiveOffset === 0) {
      setPositiveItems(data.mostPositive);
    } else if (data.positiveOffset === positiveItems.length) {
      setPositiveItems((current) => [...current, ...data.mostPositive]);
    }
    if (data.negativeOffset === 0) {
      setNegativeItems(data.mostNegative);
    } else if (data.negativeOffset === negativeItems.length) {
      setNegativeItems((current) => [...current, ...data.mostNegative]);
    }
  }, [extremesFrom, extremesQuery.data, extremesTo, negativeItems.length, positiveItems.length]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Sentiment</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Per-document polarity scored by VADER (lexicon-based, sentence-level length-weighted
          compound). The page opens on the full span of dated documents with sentiment scores;
          narrow the range to focus on a specific period. Each polarity is in{' '}
          <code className="text-xs">[-1, +1]</code>; values near zero are neutral.
        </p>
      </header>

      <form
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end lg:gap-4"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Sentiment date range"
      >
        <label className="flex flex-col text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          From
          <input
            type="date"
            value={from ?? ''}
            disabled={!datesReady || corpusEmpty}
            onChange={(e) => {
              userTouchedDates.current = true;
              setSelectedPeriod(null);
              setFrom(e.target.value);
            }}
            className="input mt-1 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          To
          <input
            type="date"
            value={to ?? ''}
            disabled={!datesReady || corpusEmpty}
            onChange={(e) => {
              userTouchedDates.current = true;
              setSelectedPeriod(null);
              setTo(e.target.value);
            }}
            className="input mt-1 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          Bin
          <select
            value={bin}
            disabled={!datesReady || corpusEmpty}
            onChange={(e) => {
              userTouchedDates.current = true;
              setSelectedPeriod(null);
              setBin(e.target.value as SentimentBin);
            }}
            className="input mt-1 text-sm normal-case tracking-normal"
          >
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={!corpusMin || !corpusMax}
          onClick={() => {
            userTouchedDates.current = false;
            setSelectedPeriod(null);
            setFrom(corpusMin);
            setTo(corpusMax);
            setBin('month');
          }}
        >
          Reset
        </button>
      </form>

      {isLoading && <LoadingModal message="Loading sentiment data..." />}
      {error && (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load sentiment.'}
        </p>
      )}

      {!isLoading && !error && corpusEmpty && (
        <div className="rounded-md border border-ink-700/10 dark:border-parchment-50/10 bg-parchment-50/40 dark:bg-ink-800/40 p-6 text-sm">
          <p>No sentiment data has been computed yet.</p>
        </div>
      )}

      {!isLoading && !error && !corpusEmpty && datesReady && (
        <>
          <section className="mb-10">
            <h2 className="uppercase tracking-wide text-xs text-ink-700/70 dark:text-parchment-100/70 mb-3">
              TR&rsquo;s mood across {from} &ndash; {to}
            </h2>
            {points.length === 0 ? (
              <div className="rounded-md border border-ink-700/10 dark:border-parchment-50/10 bg-parchment-50/40 dark:bg-ink-800/40 p-6 text-sm">
                <p>
                  No sentiment data in this range. Try widening the date filter, or click Reset to
                  restore the full corpus range.
                </p>
              </div>
            ) : (
              <MoodChart
                points={points}
                bin={bin}
                selectedPeriod={selectedPeriod?.period ?? null}
                onTogglePeriod={togglePeriod}
              />
            )}
          </section>

          {selectedPeriod && (
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink-700/80 dark:text-parchment-100/80">
              <span>Showing documents for {selectedPeriod.period}</span>
              <button
                type="button"
                className="btn py-1 text-xs"
                onClick={() => setSelectedPeriod(null)}
              >
                Clear selection
              </button>
            </div>
          )}

          {(positiveItems.length > 0 || negativeItems.length > 0) && (
            <div className="grid gap-8 md:grid-cols-2">
              <div>
                <ExtremeList
                  title="Most positive"
                  items={positiveItems}
                  emptyHint="No positive documents in this range."
                />
                {positiveItems.length < positiveTotal && (
                  <button
                    type="button"
                    className="btn mt-4"
                    disabled={extremesQuery.isFetching}
                    onClick={() => setPositiveOffset(positiveItems.length)}
                  >
                    {extremesQuery.isFetching ? 'Loading...' : 'Load more positive'}
                  </button>
                )}
              </div>
              <div>
                <ExtremeList
                  title="Most negative"
                  items={negativeItems}
                  emptyHint="No negative documents in this range."
                />
                {negativeItems.length < negativeTotal && (
                  <button
                    type="button"
                    className="btn mt-4"
                    disabled={extremesQuery.isFetching}
                    onClick={() => setNegativeOffset(negativeItems.length)}
                  >
                    {extremesQuery.isFetching ? 'Loading...' : 'Load more negative'}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
