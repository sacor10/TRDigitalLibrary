import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Document } from '@tr/shared';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelinePage } from './TimelinePage';

const { fetchDocumentsMock, fetchTopicsMock, searchDocumentsMock } = vi.hoisted(() => ({
  fetchDocumentsMock: vi.fn(),
  fetchTopicsMock: vi.fn(),
  searchDocumentsMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  fetchDocuments: fetchDocumentsMock,
  fetchTopics: fetchTopicsMock,
  searchDocuments: searchDocumentsMock,
}));

function makeDoc(id: string, date = '1910-04-23'): Document {
  return {
    id,
    title: `Doc ${id}`,
    type: 'letter',
    date,
    recipient: null,
    location: null,
    author: 'Theodore Roosevelt',
    transcription: '',
    transcriptionUrl: null,
    transcriptionFormat: 'plain-text',
    facsimileUrl: null,
    iiifManifestUrl: null,
    provenance: null,
    source: 'test',
    sourceUrl: null,
    tags: [],
    mentions: [],
    teiXml: null,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TimelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TimelinePage filters', () => {
  beforeEach(() => {
    fetchDocumentsMock.mockReset();
    fetchTopicsMock.mockReset();
    searchDocumentsMock.mockReset();
    fetchDocumentsMock.mockResolvedValue({ items: [makeDoc('a')], total: 1 });
    fetchTopicsMock.mockResolvedValue({
      items: [
        {
          id: 2,
          label: 'progressive, party, primary',
          keywords: ['progressive', 'party', 'primary'],
          size: 3,
          computedAt: '2026-05-09T12:00:00Z',
          modelVersion: 'test',
        },
      ],
      total: 1,
    });
    searchDocumentsMock.mockResolvedValue({ results: [], total: 0 });
  });

  afterEach(() => {
    fetchDocumentsMock.mockReset();
    fetchTopicsMock.mockReset();
    searchDocumentsMock.mockReset();
  });

  it('fetches timeline documents with date filters and clears them on reset', async () => {
    renderPage();

    await waitFor(() => {
      expect(fetchDocumentsMock).toHaveBeenCalledWith({
        sort: 'date',
        order: 'asc',
        limit: 100,
      });
    });

    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: '1910-01-01' } });

    await waitFor(() => {
      expect(fetchDocumentsMock).toHaveBeenLastCalledWith({
        dateFrom: '1910-01-01',
        sort: 'date',
        order: 'asc',
        limit: 100,
      });
    });

    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: '1910-12-31' } });

    await waitFor(() => {
      expect(fetchDocumentsMock).toHaveBeenLastCalledWith({
        dateFrom: '1910-01-01',
        dateTo: '1910-12-31',
        sort: 'date',
        order: 'asc',
        limit: 100,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));

    await waitFor(() => {
      expect(fetchDocumentsMock).toHaveBeenLastCalledWith({
        sort: 'date',
        order: 'asc',
        limit: 100,
      });
    });
  });

  it('uses keyword search with topic, type, recipient, and date filters', async () => {
    searchDocumentsMock.mockResolvedValue({
      results: [{ document: makeDoc('topic-hit', '1910-08-31'), snippet: '<mark>party</mark>' }],
      total: 1,
    });

    renderPage();

    expect(await screen.findByRole('option', { name: /progressive, party, primary/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/search transcriptions and titles/i), {
      target: { value: 'party' },
    });
    fireEvent.change(screen.getByLabelText(/^topic$/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/^type$/i), { target: { value: 'speech' } });
    fireEvent.change(screen.getByLabelText(/^recipient$/i), { target: { value: 'Lodge' } });
    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: '1910-01-01' } });
    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: '1910-12-31' } });

    await waitFor(() => {
      expect(searchDocumentsMock).toHaveBeenLastCalledWith({
        q: 'party',
        topicId: 2,
        type: 'speech',
        recipient: 'Lodge',
        dateFrom: '1910-01-01',
        dateTo: '1910-12-31',
        limit: 100,
        offset: 0,
      });
    });
    await waitFor(() => {
      expect(screen.getByText(/1 matching document/i)).toBeTruthy();
    });
  });
});
