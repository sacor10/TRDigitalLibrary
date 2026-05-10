import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { Document } from '@tr/shared';

import { Timeline } from './Timeline';

function makeDoc(overrides: Partial<Document> & Pick<Document, 'id' | 'date' | 'type' | 'title'>): Document {
  return {
    recipient: null,
    location: null,
    author: 'Theodore Roosevelt',
    transcription: '',
    transcriptionUrl: null,
    transcriptionFormat: 'wikisource-html',
    facsimileUrl: null,
    iiifManifestUrl: null,
    provenance: null,
    source: 'Wikisource',
    sourceUrl: 'https://example.org',
    tags: [],
    mentions: [],
    teiXml: null,
    ...overrides,
  } as Document;
}

const docs: Document[] = [
  makeDoc({ id: 'a', title: 'A', type: 'article', date: '1899-01-01' }),
  makeDoc({ id: 'b', title: 'B', type: 'speech', date: '1899-04-10' }),
  makeDoc({ id: 'c', title: 'C', type: 'speech', date: '1901-12-03' }),
  makeDoc({ id: 'd', title: 'D', type: 'speech', date: '1908-05-13' }),
  makeDoc({ id: 'e', title: 'E', type: 'speech', date: '1910-04-23' }),
  makeDoc({ id: 'f', title: 'F', type: 'speech', date: '1910-08-31' }),
  makeDoc({ id: 'g', title: 'G', type: 'autobiography', date: '1913-01-01' }),
  makeDoc({ id: 'h', title: 'H', type: 'letter', date: '1919-01-01' }),
];

function renderTimeline(input: Document[] = docs) {
  return render(
    <MemoryRouter>
      <Timeline documents={input} />
    </MemoryRouter>,
  );
}

describe('Timeline', () => {
  it('renders one circle marker per document inside an undistorted SVG', () => {
    const { container } = renderTimeline();
    const svg = container.querySelector('svg[aria-label="Document timeline"]');
    expect(svg).not.toBeNull();
    // viewBox uses real pixel-style coordinates, not the legacy 100x110 stretched grid.
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1200 280');
    // No preserveAspectRatio="none" — markers must remain circular.
    expect(svg?.getAttribute('preserveAspectRatio')).toBeNull();

    const circles = svg?.querySelectorAll('circle') ?? [];
    expect(circles.length).toBe(docs.length);
  });

  it('renders full four-digit year labels positioned within the viewBox', () => {
    const { container } = renderTimeline();
    const svg = container.querySelector('svg[aria-label="Document timeline"]')!;
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);
    expect(labels).toContain('1899');
    expect(labels).toContain('1919');

    // Every tick label sits inside the viewBox horizontally with margin to spare.
    for (const text of svg.querySelectorAll('text')) {
      const x = Number(text.getAttribute('x'));
      expect(x).toBeGreaterThanOrEqual(20);
      expect(x).toBeLessThanOrEqual(1180);
    }
  });

  it('shows an empty state when no documents are provided', () => {
    const { getByText, container } = renderTimeline([]);
    expect(getByText(/No documents to plot/i)).toBeTruthy();
    expect(container.querySelector('svg[aria-label="Document timeline"]')).toBeNull();
  });
});
