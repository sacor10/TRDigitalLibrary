import { fireEvent, render, screen } from '@testing-library/react';
import type { Document } from '@tr/shared';
import type { ComponentProps } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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

type TimelineOptions = Partial<Omit<ComponentProps<typeof Timeline>, 'documents'>>;

function renderTimeline(input: Document[] = docs, props: TimelineOptions = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Timeline documents={input} {...props} />} />
        <Route path="/documents/:id" element={<p>Document opened</p>} />
      </Routes>
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
    // No preserveAspectRatio="none" - markers must remain circular.
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

  it('zooms to six months centered on a marker when the current range is at least six months', () => {
    const onDateRangeChange = vi.fn();
    renderTimeline(docs, {
      dateFrom: '1899-01-01',
      dateTo: '1919-01-01',
      onDateRangeChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'E, 1910-04-23' }));

    expect(onDateRangeChange).toHaveBeenCalledWith({
      dateFrom: '1910-01-23',
      dateTo: '1910-07-23',
      selectedDocumentId: 'e',
    });
    expect(screen.queryByText(/Document opened/i)).toBeNull();
  });

  it('opens the document on the second activation of the selected marker', () => {
    const onDateRangeChange = vi.fn();
    renderTimeline(docs, {
      dateFrom: '1910-01-23',
      dateTo: '1910-07-23',
      selectedDocumentId: 'e',
      onDateRangeChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'E, 1910-04-23' }));

    expect(onDateRangeChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Document opened/i)).toBeTruthy();
  });

  it('recenters the six-month window when another marker is activated at exactly six months', () => {
    const onDateRangeChange = vi.fn();
    renderTimeline(docs, {
      dateFrom: '1910-04-01',
      dateTo: '1910-10-01',
      selectedDocumentId: 'e',
      onDateRangeChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'F, 1910-08-31' }));

    expect(onDateRangeChange).toHaveBeenCalledWith({
      dateFrom: '1910-05-31',
      dateTo: '1910-11-30',
      selectedDocumentId: 'f',
    });
  });

  it('opens immediately when the current range is shorter than six months', () => {
    const onDateRangeChange = vi.fn();
    renderTimeline(docs, {
      dateFrom: '1910-04-01',
      dateTo: '1910-09-30',
      onDateRangeChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'F, 1910-08-31' }));

    expect(onDateRangeChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Document opened/i)).toBeTruthy();
  });

  it('renders month labels for a six-month domain', () => {
    const { container } = renderTimeline(docs, {
      dateFrom: '1910-01-23',
      dateTo: '1910-07-23',
    });
    const svg = container.querySelector('svg[aria-label="Document timeline"]')!;
    const labels = Array.from(svg.querySelectorAll('text')).map((t) => t.textContent);

    expect(labels).toContain('Jan 1910');
    expect(labels).toContain('Jul 1910');
  });
});
