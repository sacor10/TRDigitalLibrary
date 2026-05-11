import type { CorrespondentEdge, CorrespondentNode } from '@tr/shared';
import type cytoscape from 'cytoscape';
import { useEffect, useMemo, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';


interface Props {
  nodes: CorrespondentNode[];
  edges: CorrespondentEdge[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  height?: number | string;
}

const STYLESHEET: cytoscape.StylesheetJsonBlock[] = [
  {
    selector: 'node',
    style: {
      'background-color': '#8b5e3c',
      label: 'data(label)',
      color: '#1f1b16',
      'font-size': 11,
      'font-family': 'Georgia, serif',
      'text-valign': 'bottom',
      'text-margin-y': 6,
      'text-wrap': 'wrap',
      'text-max-width': '120px',
      'border-width': 1,
      'border-color': '#3b2a1a',
      width: 'data(size)',
      height: 'data(size)',
    },
  },
  {
    selector: 'node[?isTR]',
    style: {
      'background-color': '#b04632',
      'border-color': '#5b1f12',
      'border-width': 2,
      width: 56,
      height: 56,
      'font-weight': 'bold',
      'font-size': 13,
    },
  },
  {
    selector: 'node.selected',
    style: {
      'border-color': '#1d4ed8',
      'border-width': 4,
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'bezier',
      'line-color': '#a8a29e',
      'target-arrow-shape': 'none',
      width: 'data(width)',
      opacity: 0.7,
    },
  },
  {
    selector: 'edge.incident',
    style: {
      'line-color': '#1d4ed8',
      opacity: 1,
    },
  },
];

export function CorrespondentGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
  height = 'min(70vh, 520px)',
}: Props) {
  const cyRef = useRef<cytoscape.Core | null>(null);

  const elements = useMemo(() => {
    const nodeEls = nodes.map((n) => ({
      data: {
        id: n.id,
        label:
          n.isTR || n.id === selectedId || n.totalCount >= 5 || nodes.length <= 30
            ? n.label
            : '',
        totalCount: n.totalCount,
        isTR: n.isTR,
        size: n.isTR ? 58 : Math.max(18, Math.min(52, 18 + Math.sqrt(n.totalCount) * 5)),
      },
    }));
    const edgeEls = edges.map((e) => ({
      data: {
        id: `${e.source}__${e.target}`,
        source: e.source,
        target: e.target,
        weight: e.totalCount,
        width: Math.max(1, Math.min(7, 1 + Math.sqrt(e.totalCount))),
      },
    }));
    return [...nodeEls, ...edgeEls];
  }, [nodes, edges, selectedId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('selected');
    cy.edges().removeClass('incident');
    if (!selectedId) return;
    const node = cy.getElementById(selectedId);
    if (node.empty()) return;
    node.addClass('selected');
    node.connectedEdges().addClass('incident');
  }, [selectedId, elements]);

  return (
    <CytoscapeComponent
      elements={elements}
      stylesheet={STYLESHEET}
      layout={
        {
          name: 'concentric',
          animate: false,
          padding: 32,
          minNodeSpacing: 18,
          concentric: (node: cytoscape.NodeSingular) => (node.data('isTR') ? 2 : 1),
          levelWidth: () => 1,
        } as cytoscape.LayoutOptions
      }
      style={{ width: '100%', height }}
      cy={(cy) => {
        cyRef.current = cy;
        cy.removeListener('tap', 'node');
        cy.on('tap', 'node', (evt) => {
          const id = evt.target.id() as string;
          onSelect(id);
        });
      }}
      wheelSensitivity={0.2}
    />
  );
}
