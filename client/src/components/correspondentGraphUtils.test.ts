import type { CorrespondentEdge, CorrespondentNode } from '@tr/shared';
import { describe, expect, it } from 'vitest';

import { buildCorrespondentGraphElements, visibleLabelIds } from './correspondentGraphUtils';

function makeNode(index: number, totalCount: number): CorrespondentNode {
  return {
    id: `person-${index}`,
    label: `Person ${index}`,
    totalCount,
    inboundCount: Math.floor(totalCount / 2),
    outboundCount: totalCount - Math.floor(totalCount / 2),
    firstDate: null,
    lastDate: null,
    isTR: false,
  };
}

const trNode: CorrespondentNode = {
  id: 'theodore-roosevelt',
  label: 'Theodore Roosevelt',
  totalCount: 99,
  inboundCount: 50,
  outboundCount: 49,
  firstDate: null,
  lastDate: null,
  isTR: true,
};

const sampleEdges: CorrespondentEdge[] = [
  {
    source: 'theodore-roosevelt',
    target: 'person-1',
    totalCount: 9,
    fromTrCount: 9,
    toTrCount: 0,
    firstDate: null,
    lastDate: null,
  },
  {
    source: 'person-2',
    target: 'theodore-roosevelt',
    totalCount: 4,
    fromTrCount: 0,
    toTrCount: 4,
    firstDate: null,
    lastDate: null,
  },
];

describe('visibleLabelIds', () => {
  it('shows every correspondent label in small graphs', () => {
    const nodes = [trNode, makeNode(1, 8), makeNode(2, 5), makeNode(3, 2)];

    expect(Array.from(visibleLabelIds(nodes, null)).sort()).toEqual(
      ['person-1', 'person-2', 'person-3', 'theodore-roosevelt'].sort(),
    );
  });

  it('keeps TR and the selected correspondent visible in denser graphs', () => {
    const nodes = [
      trNode,
      ...Array.from({ length: 18 }, (_, index) => makeNode(index + 1, 30 - index)),
    ];

    const ids = visibleLabelIds(nodes, 'person-18');

    expect(ids.has('theodore-roosevelt')).toBe(true);
    expect(ids.has('person-18')).toBe(true);
    expect(ids.has('person-1')).toBe(true);
    expect(ids.has('person-12')).toBe(false);
  });
});

describe('buildCorrespondentGraphElements', () => {
  it('positions Theodore Roosevelt at the center and encodes edge direction classes', () => {
    const nodes = [trNode, makeNode(1, 9), makeNode(2, 4)];
    const elements = buildCorrespondentGraphElements(nodes, sampleEdges, 'person-2');

    const trElement = elements.find((element) => element.data?.id === 'theodore-roosevelt');
    const outgoingEdge = elements.find(
      (element) => element.data?.id === 'theodore-roosevelt__person-1',
    );
    const incomingEdge = elements.find(
      (element) => element.data?.id === 'person-2__theodore-roosevelt',
    );
    const selectedNode = elements.find((element) => element.data?.id === 'person-2');

    expect(trElement?.position).toEqual({ x: 0, y: 0 });
    expect(outgoingEdge?.classes).toContain('from-tr');
    expect(incomingEdge?.classes).toContain('to-tr');
    expect(selectedNode?.data?.label).toBe('Person 2');
  });

  it('places higher-count correspondents on a smaller ring than lower-count ones', () => {
    const nodes = [
      trNode,
      makeNode(1, 100),
      makeNode(2, 25),
      makeNode(3, 10),
      makeNode(4, 1),
    ];
    const elements = buildCorrespondentGraphElements(nodes, [], null);

    const radiusFor = (id: string) => {
      const el = elements.find((e) => e.data?.id === id);
      const x = el?.position?.x ?? 0;
      const y = el?.position?.y ?? 0;
      return Math.hypot(x, y);
    };

    expect(radiusFor('person-1')).toBeLessThan(radiusFor('person-4'));
  });

  it('falls back to a single inner ring when all correspondents have equal counts', () => {
    const nodes = [trNode, ...Array.from({ length: 6 }, (_, i) => makeNode(i + 1, 1))];
    const elements = buildCorrespondentGraphElements(nodes, [], null);

    const correspondentElements = elements.filter(
      (e) => e.data?.id !== 'theodore-roosevelt' && e.position,
    );
    correspondentElements.forEach((el) => {
      const radius = Math.hypot(el.position?.x ?? 0, el.position?.y ?? 0);
      expect(Math.abs(radius - 180)).toBeLessThanOrEqual(1);
    });
  });

  it('spills overflow from a saturated tier outward to the next ring', () => {
    const nodes = [trNode, ...Array.from({ length: 20 }, (_, i) => makeNode(i + 1, 50))];
    const elements = buildCorrespondentGraphElements(nodes, [], null);

    const radii = elements
      .filter((e) => e.data?.id !== 'theodore-roosevelt' && e.position)
      .map((e) => Math.hypot(e.position?.x ?? 0, e.position?.y ?? 0));

    const innerRingHit = radii.some((r) => Math.abs(r - 180) <= 1);
    const secondRingHit = radii.some((r) => Math.abs(r - 300) <= 1);

    expect(innerRingHit).toBe(true);
    expect(secondRingHit).toBe(true);
  });

  it('scales bubble size with totalCount within the documented bounds', () => {
    const nodes = [trNode, makeNode(1, 1), makeNode(2, 10), makeNode(3, 200)];
    const elements = buildCorrespondentGraphElements(nodes, [], null);

    const sizeFor = (id: string) =>
      elements.find((e) => e.data?.id === id)?.data?.size as number;

    const small = sizeFor('person-1');
    const medium = sizeFor('person-2');
    const large = sizeFor('person-3');
    const tr = sizeFor('theodore-roosevelt');

    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
    [small, medium, large].forEach((size) => {
      expect(size).toBeGreaterThanOrEqual(16);
      expect(size).toBeLessThanOrEqual(54);
    });
    expect(tr).toBe(62);
  });
});
