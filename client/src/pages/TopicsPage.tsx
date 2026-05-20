import { useQuery } from '@tanstack/react-query';
import type { TopicDriftPoint } from '@tr/shared';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchTopic, fetchTopicDrift, fetchTopics } from '../api/client';

const SPARK_W = 96;
const SPARK_H = 34;
const CHART_W = 760;
const CHART_H = 300;

interface TopicTrendPoint {
  period: string;
  documentCount: number;
  share: number;
}

interface TopicTrendSummary {
  activeYears: number;
  totalDocuments: number;
  peakCount: TopicTrendPoint;
  peakShare: TopicTrendPoint;
  shareRange: number;
  trend: 'flat' | 'rising' | 'falling' | 'spiky';
}

function uniqueSortedPeriods(points: TopicDriftPoint[]): string[] {
  const set = new Set<string>();
  for (const p of points) set.add(p.period);
  return Array.from(set).sort();
}

function trendPointsForTopic(
  points: TopicDriftPoint[],
  topicId: string,
  periods: string[],
): TopicTrendPoint[] {
  const byPeriod = new Map(points.filter((p) => p.topicId === topicId).map((p) => [p.period, p]));
  return periods.map((period) => {
    const point = byPeriod.get(period);
    return {
      period,
      documentCount: point?.documentCount ?? 0,
      share: point?.share ?? 0,
    };
  });
}

function formatPercent(value: number): string {
  if (value === 0) return '0%';
  if (value < 0.01) return `${(value * 100).toFixed(1)}%`;
  return `${(value * 100).toFixed(0)}%`;
}

function summarizeTrend(points: TopicTrendPoint[]): TopicTrendSummary {
  const active = points.filter((p) => p.documentCount > 0);
  const shares = active.map((p) => p.share);
  const fallback = points[0] ?? { period: '', documentCount: 0, share: 0 };
  const totalDocuments = active.reduce((sum, p) => sum + p.documentCount, 0);
  const peakCount = active.reduce(
    (best, p) => (p.documentCount > best.documentCount ? p : best),
    active[0] ?? fallback,
  );
  const peakShare = active.reduce(
    (best, p) => (p.share > best.share ? p : best),
    active[0] ?? fallback,
  );
  const shareRange = shares.length > 0 ? Math.max(...shares) - Math.min(...shares) : 0;

  let trend: TopicTrendSummary['trend'] = 'flat';
  if (active.length >= 3 && shareRange > 0.005) {
    const sortedShares = [...shares].sort((a, b) => a - b);
    const median = sortedShares[Math.floor(sortedShares.length / 2)] ?? 0;
    if (median > 0 && peakShare.share >= median * 2.25) {
      trend = 'spiky';
    } else {
      const midpoint = Math.ceil(active.length / 2);
      const first = active.slice(0, midpoint);
      const last = active.slice(-midpoint);
      const firstAvg = first.reduce((sum, p) => sum + p.share, 0) / first.length;
      const lastAvg = last.reduce((sum, p) => sum + p.share, 0) / last.length;
      trend = lastAvg > firstAvg ? 'rising' : 'falling';
    }
  }

  return {
    activeYears: active.length,
    totalDocuments,
    peakCount,
    peakShare,
    shareRange,
    trend,
  };
}

function showFlatDataNote(summary: TopicTrendSummary): boolean {
  return summary.activeYears >= 3 && summary.totalDocuments >= 10 && summary.shareRange <= 0.0025;
}

function TrendSparkline({
  points,
  maxShare,
  maxCount,
}: {
  points: TopicTrendPoint[];
  maxShare: number;
  maxCount: number;
}) {
  if (points.length === 0) {
    return (
      <span className="text-ink-700/60 dark:text-parchment-100/60 text-xs">no drift data</span>
    );
  }

  const safeMaxShare = Math.max(0.0001, maxShare);
  const safeMaxCount = Math.max(1, maxCount);
  const barW = Math.max(1.5, SPARK_W / points.length - 1);
  const stepX = points.length > 1 ? SPARK_W / (points.length - 1) : 0;
  const path = points
    .map((point, i) => {
      const x = i * stepX;
      const y = SPARK_H - (point.share / safeMaxShare) * (SPARK_H - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const summary = summarizeTrend(points);

  return (
    <div>
      <svg
        width={SPARK_W}
        height={SPARK_H}
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        role="img"
        aria-label="Topic count and share over time"
        className="text-accent-500"
      >
        {points.map((point, i) => {
          const height = (point.documentCount / safeMaxCount) * (SPARK_H - 4);
          const x = i * (SPARK_W / points.length);
          return (
            <rect
              key={point.period}
              x={x}
              y={SPARK_H - height}
              width={barW}
              height={height}
              fill="currentColor"
              opacity={0.28}
            >
              <title>
                {point.period}: {point.documentCount} docs, {formatPercent(point.share)} share
              </title>
            </rect>
          );
        })}
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.6} />
      </svg>
      <span className="mt-2 inline-flex rounded-full bg-parchment-200/70 px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-wide text-ink-700 dark:bg-ink-700 dark:text-parchment-50">
        {summary.trend}
      </span>
    </div>
  );
}

function DriftChart({ points }: { points: TopicTrendPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-ink-700/70 dark:text-parchment-100/70">
        No drift data for this topic yet.
      </p>
    );
  }

  const padding = { top: 20, right: 52, bottom: 40, left: 48 };
  const innerW = CHART_W - padding.left - padding.right;
  const innerH = CHART_H - padding.top - padding.bottom;
  const maxCount = Math.max(1, ...points.map((p) => p.documentCount));
  const maxShare = Math.max(0.05, ...points.map((p) => p.share));
  const barSlot = innerW / Math.max(1, points.length);
  const barW = Math.max(5, Math.min(22, barSlot * 0.62));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const countToY = (value: number) => padding.top + innerH - (value / maxCount) * innerH;
  const shareToY = (value: number) => padding.top + innerH - (value / maxShare) * innerH;
  const linePath = points
    .map((point, i) => {
      const x = padding.left + i * stepX;
      const y = shareToY(point.share);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const countTicks = [0, Math.ceil(maxCount / 2), maxCount];
  const shareTicks = [maxShare / 2, maxShare];
  const xTickEvery = Math.max(1, Math.ceil(points.length / 10));
  const summary = summarizeTrend(points);

  return (
    <div>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <svg
          width="100%"
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          role="img"
          aria-label="Topic document count and corpus share over time"
          className="min-w-[44rem] text-accent-500 sm:min-w-0"
        >
          {countTicks.map((tv) => {
            const y = countToY(tv);
            return (
              <g key={`count-${tv}`}>
                <line
                  x1={padding.left}
                  x2={padding.left + innerW}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.13}
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="currentColor"
                  fillOpacity={0.72}
                >
                  {tv}
                </text>
              </g>
            );
          })}
          {shareTicks.map((tv) => {
            const y = shareToY(tv);
            return (
              <text
                key={`share-${tv}`}
                x={padding.left + innerW + 8}
                y={y + 4}
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.72}
              >
                {formatPercent(tv)}
              </text>
            );
          })}
          {points.map((point, i) => {
            const x = padding.left + i * barSlot + (barSlot - barW) / 2;
            const y = countToY(point.documentCount);
            const height = padding.top + innerH - y;
            return (
              <rect
                key={`bar-${point.period}`}
                x={x}
                y={y}
                width={barW}
                height={height}
                rx={1.5}
                fill="currentColor"
                opacity={0.28}
              >
                <title>
                  {point.period}: {point.documentCount} docs, {formatPercent(point.share)} share
                </title>
              </rect>
            );
          })}
          <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2.25} />
          {points.map((point, i) => {
            const x = padding.left + i * stepX;
            const y = shareToY(point.share);
            return (
              <circle key={`point-${point.period}`} cx={x} cy={y} r={3} fill="currentColor">
                <title>
                  {point.period}: {point.documentCount} docs, {formatPercent(point.share)} share
                </title>
              </circle>
            );
          })}
          {points.map((point, i) =>
            i % xTickEvery === 0 || i === points.length - 1 ? (
              <text
                key={`x-${point.period}`}
                x={padding.left + i * stepX}
                y={CHART_H - padding.bottom + 20}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.72}
              >
                {point.period}
              </text>
            ) : null,
          )}
          <text
            x={padding.left}
            y={CHART_H - 8}
            fontSize={10}
            fill="currentColor"
            fillOpacity={0.72}
          >
            docs/year
          </text>
          <text
            x={padding.left + innerW}
            y={CHART_H - 8}
            textAnchor="end"
            fontSize={10}
            fill="currentColor"
            fillOpacity={0.72}
          >
            share of tagged corpus
          </text>
        </svg>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-700/60 dark:text-parchment-100/60">
            Peak year
          </dt>
          <dd className="font-semibold">
            {summary.peakCount.period || 'n/a'} ({summary.peakCount.documentCount} docs)
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-700/60 dark:text-parchment-100/60">
            Peak share
          </dt>
          <dd className="font-semibold">
            {summary.peakShare.period || 'n/a'} ({formatPercent(summary.peakShare.share)})
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-700/60 dark:text-parchment-100/60">
            Total in chart
          </dt>
          <dd className="font-semibold">{summary.totalDocuments} documents</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-700/60 dark:text-parchment-100/60">
            Active years
          </dt>
          <dd className="font-semibold">{summary.activeYears}</dd>
        </div>
      </dl>
      {showFlatDataNote(summary) && (
        <p className="mt-4 rounded-md border border-ink-700/10 bg-parchment-50/60 p-3 text-sm text-ink-700/80 dark:border-parchment-50/10 dark:bg-ink-800/50 dark:text-parchment-100/80">
          This topic is assigned at a nearly constant share across years; counts may be more
          informative than share.
        </p>
      )}
    </div>
  );
}

function TopicsGrid() {
  const topicsQuery = useQuery({ queryKey: ['topics'], queryFn: fetchTopics });
  const driftQuery = useQuery({ queryKey: ['topics-drift'], queryFn: fetchTopicDrift });

  const periods = useMemo(
    () => (driftQuery.data ? uniqueSortedPeriods(driftQuery.data.points) : []),
    [driftQuery.data],
  );
  const globalMaxShare = useMemo(
    () => Math.max(0.0001, ...(driftQuery.data?.points.map((p) => p.share) ?? [])),
    [driftQuery.data],
  );
  const globalMaxCount = useMemo(
    () => Math.max(1, ...(driftQuery.data?.points.map((p) => p.documentCount) ?? [])),
    [driftQuery.data],
  );

  if (topicsQuery.isLoading || driftQuery.isLoading) return <p>Loading&hellip;</p>;
  if (topicsQuery.error) {
    return (
      <p className="text-red-600 dark:text-red-400">
        {topicsQuery.error instanceof Error ? topicsQuery.error.message : 'Failed to load topics.'}
      </p>
    );
  }

  const topics = topicsQuery.data?.items ?? [];
  if (topics.length === 0) {
    return (
      <div className="rounded-md border border-ink-700/10 dark:border-parchment-50/10 bg-parchment-50/40 dark:bg-ink-800/40 p-6 text-sm">
        <p>No topics yet.</p>
        <p className="mt-2 text-ink-700/70 dark:text-parchment-100/70">
          Topics come from document tags. Ingest documents with tagged metadata, or add tags to
          existing documents.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {topics.map((topic) => {
        const drift = driftQuery.data
          ? trendPointsForTopic(driftQuery.data.points, topic.id, periods)
          : [];
        return (
          <li key={topic.id}>
            <Link
              to={`/topics/${encodeURIComponent(topic.id)}`}
              className="block h-full rounded-md border border-ink-700/10 bg-parchment-50/40 p-4 hover:bg-parchment-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-parchment-50/10 dark:bg-ink-800/40 dark:hover:bg-ink-700/60"
            >
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="truncate font-semibold" title={topic.label}>
                  {topic.label}
                </h2>
                <span className="text-xs text-ink-700/70 dark:text-parchment-100/70">
                  {topic.size} {topic.size === 1 ? 'doc' : 'docs'}
                </span>
              </div>
              <TrendSparkline points={drift} maxShare={globalMaxShare} maxCount={globalMaxCount} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TopicDetail({ id }: { id: string }) {
  const detailQuery = useQuery({
    queryKey: ['topic', id],
    queryFn: () => fetchTopic(id, 25),
  });
  const driftQuery = useQuery({ queryKey: ['topics-drift'], queryFn: fetchTopicDrift });

  const periods = useMemo(
    () => (driftQuery.data ? uniqueSortedPeriods(driftQuery.data.points) : []),
    [driftQuery.data],
  );

  if (detailQuery.isLoading || driftQuery.isLoading) return <p>Loading&hellip;</p>;
  if (detailQuery.error) {
    const status =
      detailQuery.error instanceof Error && detailQuery.error.message.includes('404')
        ? 'Not found'
        : detailQuery.error instanceof Error
          ? detailQuery.error.message
          : 'Failed to load topic.';
    return <p className="text-red-600 dark:text-red-400">{status}</p>;
  }
  if (!detailQuery.data) return null;
  const { topic, members } = detailQuery.data;
  const driftPoints = driftQuery.data
    ? trendPointsForTopic(driftQuery.data.points, topic.id, periods)
    : [];

  return (
    <article>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{topic.label}</h1>
          <p className="mt-1 text-ink-700/80 dark:text-parchment-100/80">
            {topic.size} {topic.size === 1 ? 'document' : 'documents'}
          </p>
        </div>
        <Link to="/topics" className="btn">
          &larr; All topics
        </Link>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          Documents and share over time
        </h2>
        <DriftChart points={driftPoints} />
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wide text-ink-700/70 dark:text-parchment-100/70">
          Documents (most recent {members.length})
        </h2>
        {members.length === 0 ? (
          <p className="text-ink-700/70 dark:text-parchment-100/70">
            No documents are tagged with this topic.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li key={m.documentId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="w-24 shrink-0 text-xs tabular-nums text-ink-700/70 dark:text-parchment-100/70">
                  {m.date}
                </span>
                <Link
                  to={`/documents/${encodeURIComponent(m.documentId)}`}
                  className="min-w-0 underline decoration-accent-500/50 hover:decoration-accent-500"
                >
                  {m.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

export function TopicsPage() {
  const { id } = useParams<{ id?: string }>();
  if (id === undefined) {
    return (
      <div>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold sm:text-3xl">Topics</h1>
          <p className="mt-1 text-ink-700 dark:text-parchment-100">
            Topics aggregated from document tags (Library of Congress subject headings and
            collections), ordered by document count. Click a card for details.
          </p>
        </header>
        <TopicsGrid />
      </div>
    );
  }
  const tag = decodeURIComponent(id);
  if (!tag) {
    return <p className="text-red-600 dark:text-red-400">Invalid topic id: {id}</p>;
  }
  return <TopicDetail id={tag} />;
}
