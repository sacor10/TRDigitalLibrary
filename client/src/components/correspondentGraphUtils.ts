import type { CorrespondentEdge, CorrespondentNode } from '@tr/shared';
import type cytoscape from 'cytoscape';

const FULL_LABEL_NODE_LIMIT = 14;
const PRIMARY_LABEL_COUNT_SMALL = 8;
const PRIMARY_LABEL_COUNT_MEDIUM = 10;
const PRIMARY_LABEL_COUNT_LARGE = 12;
const INNER_RING_RADIUS = 180;
const RING_GAP = 120;
const MIN_ARC_SPACING = 110;
const MIN_RING_CAPACITY = 8;
const TR_NODE_ID = 'theodore-roosevelt';

type LabelPlacementClass = 'label-north' | 'label-south' | 'label-east' | 'label-west';

function compareNodes(a: CorrespondentNode, b: CorrespondentNode): number {
  if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
  return a.label.localeCompare(b.label);
}

function labelBudgetFor(nodeCount: number): number {
  if (nodeCount <= FULL_LABEL_NODE_LIMIT) return Number.POSITIVE_INFINITY;
  if (nodeCount <= 24) return PRIMARY_LABEL_COUNT_SMALL;
  if (nodeCount <= 48) return PRIMARY_LABEL_COUNT_MEDIUM;
  return PRIMARY_LABEL_COUNT_LARGE;
}

function ringCapacities(count: number): number[] {
  const capacities: number[] = [];
  let placed = 0;
  let ringIndex = 0;

  while (placed < count) {
    const radius = INNER_RING_RADIUS + ringIndex * RING_GAP;
    const maxForRing = Math.max(
      MIN_RING_CAPACITY,
      Math.floor((2 * Math.PI * radius) / MIN_ARC_SPACING),
    );
    const remaining = count - placed;
    const size = Math.min(maxForRing, remaining);
    capacities.push(size);
    placed += size;
    ringIndex += 1;
  }

  return capacities;
}

function labelPlacementFor(x: number, y: number): LabelPlacementClass {
  const absX = Math.abs(x);
  const absY = Math.abs(y);

  if (absY > absX * 1.15) {
    return y < 0 ? 'label-north' : 'label-south';
  }

  return x < 0 ? 'label-west' : 'label-east';
}

export function visibleLabelIds(
  nodes: CorrespondentNode[],
  selectedId: string | null,
): Set<string> {
  const ids = new Set<string>();
  const trNode = nodes.find((node) => node.isTR || node.id === TR_NODE_ID);
  if (trNode) ids.add(trNode.id);
  if (selectedId) ids.add(selectedId);

  const correspondents = nodes.filter((node) => !node.isTR).sort(compareNodes);
  const budget = labelBudgetFor(correspondents.length);

  correspondents.slice(0, budget).forEach((node) => ids.add(node.id));
  return ids;
}

export function buildCorrespondentGraphElements(
  nodes: CorrespondentNode[],
  edges: CorrespondentEdge[],
  selectedId: string | null,
): cytoscape.ElementDefinition[] {
  const labelIds = visibleLabelIds(nodes, selectedId);
  const correspondents = nodes.filter((node) => !node.isTR).sort(compareNodes);
  const capacities = ringCapacities(correspondents.length);
  const positionedNodes = new Map<
    string,
    { x: number; y: number; labelPlacementClass: LabelPlacementClass }
  >();

  const trNode = nodes.find((node) => node.isTR || node.id === TR_NODE_ID);
  if (trNode) {
    positionedNodes.set(trNode.id, {
      x: 0,
      y: 0,
      labelPlacementClass: 'label-south',
    });
  }

  let offset = 0;
  capacities.forEach((capacity, ringIndex) => {
    const radius = INNER_RING_RADIUS + ringIndex * RING_GAP;
    const step = (2 * Math.PI) / capacity;
    const start = -Math.PI / 2 + (ringIndex % 2 === 1 ? step / 2 : 0);

    for (let index = 0; index < capacity; index += 1) {
      const node = correspondents[offset];
      if (!node) return;

      const angle = start + index * step;
      const x = Math.round(Math.cos(angle) * radius);
      const y = Math.round(Math.sin(angle) * radius);
      positionedNodes.set(node.id, {
        x,
        y,
        labelPlacementClass: labelPlacementFor(x, y),
      });
      offset += 1;
    }
  });

  const nodeElements: cytoscape.ElementDefinition[] = nodes.map((node) => {
    const placement = positionedNodes.get(node.id) ?? {
      x: 0,
      y: 0,
      labelPlacementClass: 'label-south' as LabelPlacementClass,
    };
    const isProminent = node.isTR || node.id === selectedId;
    const classes = [
      node.isTR ? 'tr-node' : '',
      labelIds.has(node.id) ? 'label-visible' : 'label-hidden',
      placement.labelPlacementClass,
      isProminent ? 'prominent-label' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      data: {
        id: node.id,
        label: labelIds.has(node.id) ? node.label : '',
        totalCount: node.totalCount,
        isTR: node.isTR,
        size: node.isTR ? 62 : Math.max(18, Math.min(46, 20 + Math.sqrt(node.totalCount) * 4)),
      },
      classes,
      position: { x: placement.x, y: placement.y },
    };
  });

  const edgeElements: cytoscape.ElementDefinition[] = edges.map((edge) => {
    const classes = [
      edge.source === TR_NODE_ID ? 'from-tr' : '',
      edge.target === TR_NODE_ID ? 'to-tr' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return {
      data: {
        id: `${edge.source}__${edge.target}`,
        source: edge.source,
        target: edge.target,
        weight: edge.totalCount,
        width: Math.max(1.5, Math.min(6, 1.5 + Math.sqrt(edge.totalCount) * 0.9)),
      },
      classes,
    };
  });

  return [...nodeElements, ...edgeElements];
}
