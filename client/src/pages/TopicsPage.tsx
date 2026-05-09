import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import type { TopicDriftPoint } from '@tr/shared';

import { fetchTopic, fetchTopicDrift, fetchTopics } from '../api/client';

const SPARK_W = 96;
const SPARK_H = 28;
const CHART_W = 560;
const CHART_H = 220;
const BAR_W = 360;

function uniqueSortedPeriods(points: TopicDriftPoint[]): string[] {
  const set = new Set<string>();
  for (const p of points) set.add(p.period);
  return Array.from(set).sort();
}

function pointsForTopic(points: TopicDriftPoint[], topicId: number): TopicDriftPoint[] {
  return points
    .filter((p) => p.topicId === topicId)
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

function Sparkline({
  points,
  periods,
}: {
  points: TopicDriftPoint[];
  periods: string[];
}) {
  if (periods.length === 0) {
    return <span className="text-ink-700/60 dark:text-parchment-100/60 text-xs">no drift data</span>;
  }
  const byPeriod = new Map(points.map((p) => [p.period, p.share]));
  const max = Math.max(0.0001, ...points.map((p) => p.share));
  const stepX = periods.length > 1 ? SPARK_W / (periods.length - 1) : 0;
  const path = periods
    .map((period, i) => {
      const share = byPeriod.get(period) ?? 0;
      const x = i * stepX;
      const y = SPARK_H - (share / max) * SPARK_H;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      role="img"
      aria-label="Share over time"
      className="text-accent-500"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function DriftChart({
  points,
  periods,
}: {
  points: TopicDriftPoint[];
  periods: string[];
}) {
  if (periods.length === 0) {
    return <p className="text-ink-700/70 dark:text-parchment-100/70">No drift data for this topic yet.</p>;
  }
  const padding = { top: 16, right: 16, bottom: 32, left: 40 };
  const innerW = CHART_W - padding.left - padding.right;
  const innerH = CHART_H - padding.top - padding.bottom;
  const byPeriod = new Map(points.map((p) => [p.period, p.share]));
  const max = Math.max(0.05, ...points.map((p) => p.share));
  const stepX = periods.length > 1 ? innerW / (periods.length - 1) : 0;
  const linePath = periods
    .map((period, i) => {
      const share = byPeriod.get(period) ?? 0;
      const x = padding.left + i * stepX;
      const y = padding.top + innerH - (share / max) * innerH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const yTicks = [0, max / 2, max];
  const xTickEvery = Math.max(1, Math.ceil(periods.length / 8));

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label="Share of topic over time"
      className="text-accent-500"
    >
      {yTicks.map((tv, i) => {
        const y = padding.top + innerH - (tv / max) * innerH;
        return (
          <g key={i}>
            <line
              x1={padding.left}
              x2={padding.left + innerW}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.15}
            />
            <text
              x={padding.left - 6}
              y={y + 4}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {(tv * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={2} />
      {periods.map((period, i) => {
        const share = byPeriod.get(period) ?? 0;
        const x = padding.left + i * stepX;
        const y = padding.top + innerH - (share / max) * innerH;
        return <circle key={period} cx={x} cy={y} r={2.5} fill="currentColor" />;
      })}
      {periods.map((period, i) =>
        i % xTickEvery === 0 || i === periods.length - 1 ? (
          <text
            key={`x-${period}`}
            x={padding.left + i * stepX}
            y={CHART_H - padding.bottom + 16}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            fillOpacity={0.7}
          >
            {period}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function KeywordChart({ keywords }: { keywords: string[] }) {
  const items = keywords.slice(0, 15);
  if (items.length === 0) {
    return <p className="text-ink-700/70 dark:text-parchment-100/70">No keywords recorded for this topic.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {items.map((kw, i) => {
        const width = ((items.length - i) / items.length) * BAR_W;
        return (
          <li key={kw} className="flex items-center gap-3 text-sm">
            <span className="w-32 truncate" title={kw}>
              {kw}
            </span>
            <span
              aria-hidden
              className="h-3 rounded-sm bg-accent-500/70"
              style={{ width: `${width}px` }}
            />
          </li>
        );
      })}
    </ul>
  );
}

function TopicsGrid() {
  const topicsQuery = useQuery({ queryKey: ['topics'], queryFn: fetchTopics });
  const driftQuery = useQuery({ queryKey: ['topics-drift'], queryFn: fetchTopicDrift });

  const periods = useMemo(
    () => (driftQuery.data ? uniqueSortedPeriods(driftQuery.data.points) : []),
    [driftQuery.data],
  );

  if (topicsQuery.isLoading || driftQuery.isLoading) return <p>Loading&hellip;</p>;
  if (topicsQuery.error) {
    return (
      <p className="text-red-600 dark:text-red-400">
        {topicsQuery.error instanceof Error
          ? topicsQuery.error.message
          : 'Failed to load topics.'}
      </p>
    );
  }
  const topics = topicsQuery.data?.items ?? [];

  if (topics.length === 0) {
    return (
      <div className="rounded-md border border-ink-700/10 dark:border-parchment-50/10 bg-parchment-50/40 dark:bg-ink-800/40 p-6 text-sm">
        <p>
          No topics yet. Run{' '}
          <code className="px-1 py-0.5 rounded bg-parchment-200/60 dark:bg-ink-700">
            npm run topic-model
          </code>{' '}
          to populate them.
        </p>
        <p className="mt-2 text-ink-700/70 dark:text-parchment-100/70">
          The 8-document POC corpus produces &le; 1 topic; meaningful clusters require the
          full corpus. See{' '}
          <a
            className="underline decoration-accent-500/50 hover:decoration-accent-500"
            href="https://github.com/sacor10/TRDigitalLibrary/blob/main/docs/topic-modeling.md"
          >
            docs/topic-modeling.md
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {topics.map((topic) => {
        const drift = driftQuery.data ? pointsForTopic(driftQuery.data.points, topic.id) : [];
        return (
          <li key={topic.id}>
            <Link
              to={`/topics/${topic.id}`}
              className="block h-full rounded-md border border-ink-700/10 dark:border-parchment-50/10 bg-parchment-50/40 dark:bg-ink-800/40 p-4 hover:bg-parchment-100 dark:hover:bg-ink-700/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <h2 className="font-semibold truncate" title={topic.label}>
                  {topic.label}
                </h2>
                <span className="text-xs text-ink-700/70 dark:text-parchment-100/70">
                  {topic.size} {topic.size === 1 ? 'doc' : 'docs'}
                </span>
              </div>
              <ul className="flex flex-wrap gap-1 mb-3">
                {topic.keywords.slice(0, 5).map((kw) => (
                  <li
                    key={kw}
                    className="text-xs px-2 py-0.5 rounded-sm border border-ink-700/15 dark:border-parchment-50/15 text-ink-700/80 dark:text-parchment-100/80"
                  >
                    {kw}
                  </li>
                ))}
              </ul>
              <Sparkline points={drift} periods={periods} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TopicDetail({ id }: { id: number }) {
  const detailQuery = useQuery({
    queryKey: ['topic', id],
    queryFn: () => fetchTopic(id, 25),
  });
  const driftQuery = useQuery({ queryKey: ['topics-drift'], queryFn: fetchTopicDrift });

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
  const driftPoints = driftQuery.data ? pointsForTopic(driftQuery.data.points, topic.id) : [];
  const periods = driftPoints.map((p) => p.period);

  return (
    <article>
      <header className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{topic.label}</h1>
          <p className="text-ink-700/80 dark:text-parchment-100/80 mt-1">
            {topic.size} {topic.size === 1 ? 'document' : 'documents'} &middot; model{' '}
            <code className="text-xs">{topic.modelVersion}</code>
          </p>
        </div>
        <Link
          to="/topics"
          className="btn"
        >
          &larr; All topics
        </Link>
      </header>

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="uppercase tracking-wide text-xs text-ink-700/70 dark:text-parchment-100/70 mb-3">
            Top keywords
          </h2>
          <KeywordChart keywords={topic.keywords} />
        </section>

        <section>
          <h2 className="uppercase tracking-wide text-xs text-ink-700/70 dark:text-parchment-100/70 mb-3">
            Share over time
          </h2>
          <DriftChart points={driftPoints} periods={periods} />
        </section>
      </div>

      <section className="mt-10">
        <h2 className="uppercase tracking-wide text-xs text-ink-700/70 dark:text-parchment-100/70 mb-3">
          Member documents (top {members.length} by probability)
        </h2>
        {members.length === 0 ? (
          <p className="text-ink-700/70 dark:text-parchment-100/70">
            No documents are assigned to this topic.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li key={m.documentId} className="flex items-baseline gap-3">
                <span className="text-xs text-ink-700/70 dark:text-parchment-100/70 w-16 tabular-nums">
                  {(m.probability * 100).toFixed(0)}%
                </span>
                <Link
                  to={`/documents/${encodeURIComponent(m.documentId)}`}
                  className="underline decoration-accent-500/50 hover:decoration-accent-500"
                >
                  {m.title}
                </Link>
                <span className="text-ink-700/70 dark:text-parchment-100/70 text-sm">
                  {m.date}
                </span>
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
          <h1 className="text-3xl font-semibold">Topics</h1>
          <p className="text-ink-700 dark:text-parchment-100 mt-1">
            Themes BERTopic discovered across the corpus, ordered by size. Each card shows
            the top keywords and the topic&rsquo;s share of documents over time. Click a
            card for details.
          </p>
        </header>
        <TopicsGrid />
      </div>
    );
  }
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId) || numericId < 0) {
    return <p className="text-red-600 dark:text-red-400">Invalid topic id: {id}</p>;
  }
  return <TopicDetail id={numericId} />;
}
