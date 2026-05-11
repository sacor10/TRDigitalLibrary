import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Document } from '@tr/shared';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchPage } from './SearchPage';

const { searchDocumentsMock } = vi.hoisted(() => ({ searchDocumentsMock: vi.fn() }));

vi.mock('../api/client', () => ({
  searchDocuments: searchDocumentsMock,
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

function renderPage(initialPath = '/search?q=arena') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SearchPage lazy pagination', () => {
  beforeEach(() => {
    searchDocumentsMock.mockReset();
  });

  afterEach(() => {
    searchDocumentsMock.mockReset();
  });

  it('renders 10 result rows initially and pages until total reached', async () => {
    const all = Array.from({ length: 25 }, (_, i) =>
      ({ document: makeDoc(`r${String(i).padStart(2, '0')}`), snippet: '<mark>arena</mark>' }),
    );
    searchDocumentsMock
      .mockResolvedValueOnce({ results: all.slice(0, 10), total: 25 })
      .mockResolvedValueOnce({ results: all.slice(10, 20), total: 25 })
      .mockResolvedValueOnce({ results: all.slice(20, 25), total: 25 });

    const { container } = renderPage();

    await waitFor(() => {
      expect(container.querySelectorAll('ul > li').length).toBe(10);
    });

    expect(searchDocumentsMock).toHaveBeenCalledTimes(1);
    expect(searchDocumentsMock.mock.calls[0]![0].limit).toBe(10);
    expect(searchDocumentsMock.mock.calls[0]![0].offset).toBe(0);
    expect(searchDocumentsMock.mock.calls[0]![0].q).toBe('arena');

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(container.querySelectorAll('ul > li').length).toBe(20);
    });
    expect(searchDocumentsMock.mock.calls[1]![0].offset).toBe(10);

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(container.querySelectorAll('ul > li').length).toBe(25);
    });
    expect(searchDocumentsMock.mock.calls[2]![0].offset).toBe(20);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
    });
  });

  it('does not fetch on every keystroke (SearchBar 250ms debounce)', async () => {
    searchDocumentsMock.mockResolvedValue({ results: [], total: 0 });

    renderPage('/search');
    expect(searchDocumentsMock).not.toHaveBeenCalled();

    const input = screen.getByRole('searchbox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ar' } });
    fireEvent.change(input, { target: { value: 'are' } });
    fireEvent.change(input, { target: { value: 'arena' } });

    // Well under the 250ms debounce window — no fetch yet even after a few keystrokes.
    await new Promise((r) => setTimeout(r, 100));
    expect(searchDocumentsMock).not.toHaveBeenCalled();

    // After the debounce window, exactly one fetch fires with the final value.
    await waitFor(
      () => {
        expect(searchDocumentsMock).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    expect(searchDocumentsMock).toHaveBeenCalledTimes(1);
    expect(searchDocumentsMock.mock.calls[0]![0].q).toBe('arena');
  });
});
