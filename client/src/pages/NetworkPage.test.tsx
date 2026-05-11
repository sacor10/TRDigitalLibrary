import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CorrespondentGraphResponse, CorrespondentItemsResponse } from '@tr/shared';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkPage } from './NetworkPage';

const { fetchGraphMock, fetchItemsMock } = vi.hoisted(() => ({
  fetchGraphMock: vi.fn(),
  fetchItemsMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  fetchCorrespondentGraph: fetchGraphMock,
  fetchCorrespondentItems: fetchItemsMock,
}));

vi.mock('../components/CorrespondentGraph', () => ({
  CorrespondentGraph: ({
    nodes,
    onSelect,
  }: {
    nodes: Array<{ id: string; label: string }>;
    onSelect: (id: string) => void;
  }) => (
    <div aria-label="mock graph">
      {nodes.map((node) => (
        <button key={node.id} type="button" onClick={() => onSelect(node.id)}>
          {node.label}
        </button>
      ))}
    </div>
  ),
}));

const graphResponse: CorrespondentGraphResponse = {
  nodes: [
    {
      id: 'theodore-roosevelt',
      label: 'Theodore Roosevelt',
      totalCount: 2,
      inboundCount: 1,
      outboundCount: 1,
      firstDate: '1918-02-28',
      lastDate: '1918-03-01',
      isTR: true,
    },
    {
      id: 'winslow-f-t',
      label: 'Winslow, F T',
      totalCount: 2,
      inboundCount: 1,
      outboundCount: 1,
      firstDate: '1918-02-28',
      lastDate: '1918-03-01',
      isTR: false,
    },
  ],
  edges: [
    {
      source: 'theodore-roosevelt',
      target: 'winslow-f-t',
      totalCount: 2,
      fromTrCount: 1,
      toTrCount: 1,
      firstDate: '1918-02-28',
      lastDate: '1918-03-01',
    },
  ],
  totalItems: 2,
  totalCorrespondents: 2,
  generatedAt: '2026-05-11T12:00:00.000Z',
};

const itemsResponse: CorrespondentItemsResponse = {
  total: 1,
  limit: 25,
  offset: 0,
  items: [
    {
      id: 'trc-o2',
      title: 'Letter from Frank T. Winslow to Theodore Roosevelt',
      date: '1918-03-01',
      dateDisplay: '1918-03-01',
      resourceType: 'letter',
      sourceUrl: 'https://www.theodorerooseveltcenter.org/digital-library/o2/',
      collection: 'Library of Congress Manuscript Division',
      creators: [
        { id: 'winslow-f-t', label: 'Winslow, F T', rawName: 'Winslow, F T', role: 'creator' },
      ],
      recipients: [
        {
          id: 'theodore-roosevelt',
          label: 'Theodore Roosevelt',
          rawName: 'Roosevelt, Theodore, 1858-1919',
          role: 'recipient',
        },
      ],
    },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NetworkPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NetworkPage', () => {
  beforeEach(() => {
    fetchGraphMock.mockReset();
    fetchItemsMock.mockReset();
    fetchGraphMock.mockResolvedValue(graphResponse);
    fetchItemsMock.mockResolvedValue(itemsResponse);
  });

  it('renders aggregate graph stats and requests items for a selected correspondent', async () => {
    renderPage();

    await screen.findByText('2 source items');
    expect(screen.getByText('2 correspondents')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Winslow, F T' }));

    await screen.findByRole('link', {
      name: 'Letter from Frank T. Winslow to Theodore Roosevelt',
    });
    expect(fetchItemsMock).toHaveBeenCalledWith(
      'winslow-f-t',
      expect.objectContaining({ limit: 25, offset: 0 }),
    );
    const link = screen.getByRole('link', {
        name: 'Letter from Frank T. Winslow to Theodore Roosevelt',
      });
    expect(link.getAttribute('href')).toBe('https://www.theodorerooseveltcenter.org/digital-library/o2/');
  });

  it('passes filter values to the graph query', async () => {
    renderPage();
    await screen.findByText('2 source items');

    fireEvent.change(screen.getByDisplayValue('Either'), { target: { value: 'from-tr' } });
    fireEvent.change(screen.getByPlaceholderText('Name or title'), {
      target: { value: 'Winslow' },
    });

    await waitFor(() => {
      expect(fetchGraphMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ direction: 'from-tr', q: 'Winslow' }),
      );
    });
  });
});
