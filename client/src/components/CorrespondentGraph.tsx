import { useEffect, useMemo, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';
import type cytoscape from 'cytoscape';

import type { CorrespondentEdge, CorrespondentNode } from '@tr/shared';

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
      width: 'mapData(letterCount, 1, 20, 22, 60)',
      height: 'mapData(letterCount, 1, 20, 22, 60)',
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
      width: 'mapData(weight, 1, 10, 1, 6)',
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
        label: n.label,
        letterCount: n.letterCount,
        isTR: n.isTR,
      },
    }));
    const edgeEls = edges.map((e) => ({
      data: {
        id: `${e.source}__${e.target}`,
        source: e.source,
        target: e.target,
        weight: e.letterIds.length,
      },
    }));
    return [...nodeEls, ...edgeEls];
  }, [nodes, edges]);

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
          name: 'cose',
          animate: false,
          padding: 24,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 90,
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
