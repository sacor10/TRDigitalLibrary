import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import type { CorrespondentEdge, CorrespondentLetter, CorrespondentNode } from '@tr/shared';

import { fetchCorrespondentGraph } from '../api/client';
import { CorrespondentGraph } from '../components/CorrespondentGraph';

interface NeighborhoodView {
  nodes: CorrespondentNode[];
  edges: CorrespondentEdge[];
  letters: CorrespondentLetter[];
}

function buildNeighborhood(
  selectedId: string,
  nodes: CorrespondentNode[],
  edges: CorrespondentEdge[],
  letters: CorrespondentLetter[],
): NeighborhoodView {
  const incident = edges.filter((e) => e.source === selectedId || e.target === selectedId);
  const neighborIds = new Set<string>([selectedId]);
  for (const e of incident) {
    neighborIds.add(e.source);
    neighborIds.add(e.target);
  }
  const subNodes = nodes.filter((n) => neighborIds.has(n.id));
  const subEdges = edges.filter((e) => neighborIds.has(e.source) && neighborIds.has(e.target));
  const subLetters = letters.filter((l) => l.participantIds.includes(selectedId));
  return { nodes: subNodes, edges: subEdges, letters: subLetters };
}

export function NetworkPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['correspondents-graph'],
    queryFn: fetchCorrespondentGraph,
  });

  const selectedNode = useMemo(() => {
    if (!data || !selectedId) return null;
    return data.nodes.find((n) => n.id === selectedId) ?? null;
  }, [data, selectedId]);

  const neighborhood = useMemo<NeighborhoodView | null>(() => {
    if (!data || !selectedId) return null;
    return buildNeighborhood(selectedId, data.nodes, data.edges, data.letters);
  }, [data, selectedId]);

  const visible = useMemo(() => {
    if (!data) return null;
    if (focused && neighborhood) return neighborhood;
    return { nodes: data.nodes, edges: data.edges, letters: data.letters };
  }, [data, focused, neighborhood]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setFocused(false);
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl">Network of correspondents</h1>
        <p className="text-ink-700 dark:text-parchment-100 mt-1">
          Each node is a person who appears in TR&rsquo;s letters &mdash; as recipient or as someone
          he named in the body. Click a node to see their letters and the people TR connected them
          to.
        </p>
      </header>

      {isLoading && <p>Loading&hellip;</p>}
      {error && (
        <p className="text-red-600 dark:text-red-400">
          {error instanceof Error ? error.message : 'Failed to load the correspondent graph.'}
        </p>
      )}

      {data && visible && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <section
            aria-label={focused ? 'Focused subgraph' : 'Full correspondent network'}
            className="min-w-0 overflow-hidden rounded-md border border-ink-700/10 bg-parchment-50/40 dark:border-parchment-50/10 dark:bg-ink-800/40"
          >
            <CorrespondentGraph
              nodes={visible.nodes}
              edges={visible.edges}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          </section>

          <aside className="text-sm flex flex-col gap-4">
            {!selectedNode && (
              <div className="text-ink-700/80 dark:text-parchment-100/80">
                <p>
                  Click a correspondent to see their letters and the network of people TR connected
                  them to.
                </p>
                <p className="mt-2">
                  {data.nodes.length} {data.nodes.length === 1 ? 'person' : 'people'},{' '}
                  {data.letters.length} {data.letters.length === 1 ? 'letter' : 'letters'} in the
                  graph.
                </p>
              </div>
            )}

            {selectedNode && neighborhood && (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <h2 className="text-xl font-semibold">{selectedNode.label}</h2>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setFocused((v) => !v)}
                    aria-pressed={focused}
                  >
                    {focused ? 'Show full network' : 'Focus on neighbors'}
                  </button>
                </div>

                <p className="text-ink-700/80 dark:text-parchment-100/80">
                  {neighborhood.letters.length}{' '}
                  {neighborhood.letters.length === 1 ? 'letter' : 'letters'} &middot;{' '}
                  {neighborhood.nodes.length - 1}{' '}
                  {neighborhood.nodes.length - 1 === 1 ? 'connection' : 'connections'}
                </p>

                <div>
                  <h3 className="uppercase tracking-wide text-xs text-ink-700/70 dark:text-parchment-100/70 mb-2">
                    Letters
                  </h3>
                  {neighborhood.letters.length === 0 ? (
                    <p className="text-ink-700/70 dark:text-parchment-100/70">
                      No letters reference this person.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {neighborhood.letters.map((l) => (
                        <li key={l.id} className="flex flex-wrap gap-x-2 gap-y-1">
                          <Link
                            className="underline decoration-accent-500/50 hover:decoration-accent-500"
                            to={`/documents/${encodeURIComponent(l.id)}`}
                          >
                            {l.title}
                          </Link>
                          <span className="text-ink-700/70 dark:text-parchment-100/70">
                            {l.date}
                            {l.recipient ? ` — to ${l.recipient}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="uppercase tracking-wide text-xs text-ink-700/70 dark:text-parchment-100/70 mb-2">
                    People TR connected them to
                  </h3>
                  {neighborhood.nodes.length <= 1 ? (
                    <p className="text-ink-700/70 dark:text-parchment-100/70">
                      No connections in the current data.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {neighborhood.nodes
                        .filter((n) => n.id !== selectedNode.id)
                        .map((n) => (
                          <li key={n.id}>
                            <button
                              type="button"
                              className="px-2 py-1 rounded-md border border-ink-700/15 dark:border-parchment-50/15 hover:bg-parchment-200/60 dark:hover:bg-ink-700"
                              onClick={() => handleSelect(n.id)}
                            >
                              {n.label}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
