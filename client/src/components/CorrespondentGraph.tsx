import type { CorrespondentEdge, CorrespondentNode } from '@tr/shared';
import type cytoscape from 'cytoscape';
import { useEffect, useMemo, useRef } from 'react';
import CytoscapeComponent from 'react-cytoscapejs';

import { buildCorrespondentGraphElements } from './correspondentGraphUtils';


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
      'background-color': '#a06f46',
      label: 'data(label)',
      color: '#241b14',
      'font-size': 11,
      'font-family': 'Georgia, serif',
      'text-wrap': 'wrap',
      'text-max-width': '104px',
      'text-outline-width': 3,
      'text-outline-color': '#f8f4eb',
      'text-outline-opacity': 0.96,
      'text-justification': 'auto',
      'border-width': 1.5,
      'border-color': '#5f4129',
      width: 'data(size)',
      height: 'data(size)',
      opacity: 0.96,
    },
  },
  {
    selector: 'node.label-north',
    style: {
      'text-valign': 'top',
      'text-margin-y': -12,
      'text-halign': 'center',
    },
  },
  {
    selector: 'node.label-south',
    style: {
      'text-valign': 'bottom',
      'text-margin-y': 12,
      'text-halign': 'center',
    },
  },
  {
    selector: 'node.label-east',
    style: {
      'text-valign': 'center',
      'text-halign': 'right',
      'text-margin-x': 14,
    },
  },
  {
    selector: 'node.label-west',
    style: {
      'text-valign': 'center',
      'text-halign': 'left',
      'text-margin-x': -14,
    },
  },
  {
    selector: 'node.label-hidden',
    style: {
      'text-opacity': 0,
    },
  },
  {
    selector: 'node.label-visible',
    style: {
      'text-opacity': 0.98,
    },
  },
  {
    selector: 'node.prominent-label',
    style: {
      'font-size': 12,
      'font-weight': 600,
      'text-wrap': 'wrap',
      'text-max-width': '132px',
    },
  },
  {
    selector: 'node[?isTR]',
    style: {
      'background-color': '#b5533e',
      'border-color': '#6a281b',
      'border-width': 2.5,
      width: 62,
      height: 62,
      'font-weight': 'bold',
      'font-size': 13,
    },
  },
  {
    selector: 'node.related',
    style: {
      opacity: 1,
    },
  },
  {
    selector: 'node.muted',
    style: {
      opacity: 0.22,
      'text-opacity': 0.16,
    },
  },
  {
    selector: 'node.selected',
    style: {
      'background-color': '#c78657',
      'border-color': '#355f89',
      'border-width': 3,
      opacity: 1,
    },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': 'unbundled-bezier',
      'line-color': '#b9b1a5',
      'target-arrow-shape': 'triangle',
      'target-arrow-color': '#b9b1a5',
      'source-arrow-shape': 'none',
      'source-arrow-color': '#b9b1a5',
      'arrow-scale': 0.9,
      width: 'data(width)',
      opacity: 0.42,
    },
  },
  {
    selector: 'edge.from-tr',
    style: {
      'control-point-distance': -18,
    },
  },
  {
    selector: 'edge.to-tr',
    style: {
      'control-point-distance': 18,
    },
  },
  {
    selector: 'edge.muted',
    style: {
      opacity: 0.12,
    },
  },
  {
    selector: 'edge.incident',
    style: {
      'line-color': '#355f89',
      'target-arrow-color': '#355f89',
      'source-arrow-color': '#355f89',
      opacity: 0.94,
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

  const elements = useMemo(
    () => buildCorrespondentGraphElements(nodes, edges, selectedId),
    [nodes, edges, selectedId],
  );

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass('selected related muted');
    cy.edges().removeClass('incident muted');
    if (!selectedId) return;
    const node = cy.getElementById(selectedId);
    if (node.empty()) return;
    const relatedNodes = node.closedNeighborhood().nodes();
    const relatedEdges = node.connectedEdges();
    cy.nodes().difference(relatedNodes).addClass('muted');
    cy.edges().difference(relatedEdges).addClass('muted');
    relatedNodes.removeClass('muted').addClass('related');
    relatedEdges.removeClass('muted').addClass('incident');
    node.addClass('selected');
  }, [selectedId, elements]);

  return (
    <CytoscapeComponent
      elements={elements}
      stylesheet={STYLESHEET}
      layout={
        {
          name: 'preset',
          animate: false,
          fit: true,
          padding: 72,
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
