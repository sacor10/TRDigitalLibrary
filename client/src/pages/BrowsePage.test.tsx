import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Document } from '@tr/shared';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowsePage } from './BrowsePage';

const { fetchDocumentsMock } = vi.hoisted(() => ({ fetchDocumentsMock: vi.fn() }));

vi.mock('../api/client', () => ({
  fetchDocuments: fetchDocumentsMock,
}));

function makeDoc(id: string): Document {
  return {
    id,
    title: `Doc ${id}`,
    type: 'letter',
    date: '1900-01-01',
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
        <BrowsePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BrowsePage lazy pagination', () => {
  beforeEach(() => {
    fetchDocumentsMock.mockReset();
  });

  afterEach(() => {
    fetchDocumentsMock.mockReset();
  });

  it('renders 10 rows initially and appends pages on Load more until total reached', async () => {
    const allDocs = Array.from({ length: 25 }, (_, i) =>
      makeDoc(`d${String(i).padStart(2, '0')}`),
    );
    fetchDocumentsMock
      .mockResolvedValueOnce({ items: allDocs.slice(0, 10), total: 25 })
      .mockResolvedValueOnce({ items: allDocs.slice(10, 20), total: 25 })
      .mockResolvedValueOnce({ items: allDocs.slice(20, 25), total: 25 });

    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelectorAll('li').length).toBe(10);
    });

    expect(fetchDocumentsMock).toHaveBeenCalledTimes(1);
    const firstCallArgs = fetchDocumentsMock.mock.calls[0]![0];
    expect(firstCallArgs.limit).toBe(10);
    expect(firstCallArgs.offset).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(container.querySelectorAll('li').length).toBe(20);
    });
    expect(fetchDocumentsMock).toHaveBeenCalledTimes(2);
    expect(fetchDocumentsMock.mock.calls[1]![0].offset).toBe(10);

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(container.querySelectorAll('li').length).toBe(25);
    });
    expect(fetchDocumentsMock).toHaveBeenCalledTimes(3);
    expect(fetchDocumentsMock.mock.calls[2]![0].offset).toBe(20);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
    });
  });
});
