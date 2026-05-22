import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SentimentPage } from './SentimentPage';

const { fetchSentimentExtremesMock, fetchSentimentRangeMock, fetchSentimentTimelineMock } =
  vi.hoisted(() => ({
    fetchSentimentExtremesMock: vi.fn(),
    fetchSentimentRangeMock: vi.fn(),
    fetchSentimentTimelineMock: vi.fn(),
  }));

vi.mock('../api/client', () => ({
  fetchSentimentExtremes: fetchSentimentExtremesMock,
  fetchSentimentRange: fetchSentimentRangeMock,
  fetchSentimentTimeline: fetchSentimentTimelineMock,
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SentimentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makeExtreme(id: string, polarity: number) {
  return {
    documentId: id,
    title: `Document ${id}`,
    date: '1912-06-18',
    polarity,
    label: polarity >= 0 ? 'positive' : 'negative',
  };
}

describe('SentimentPage graph node filtering', () => {
  beforeEach(() => {
    fetchSentimentExtremesMock.mockReset();
    fetchSentimentRangeMock.mockReset();
    fetchSentimentTimelineMock.mockReset();

    fetchSentimentRangeMock.mockResolvedValue({
      minDate: '1912-01-15',
      maxDate: '1912-12-10',
      count: 3,
    });
    fetchSentimentTimelineMock.mockResolvedValue({
      bin: 'month',
      from: '1912-01-15',
      to: '1912-12-10',
      points: [
        { period: '1912-01', meanPolarity: 0.25, documentCount: 1 },
        { period: '1912-06', meanPolarity: 0.7, documentCount: 2 },
      ],
    });
    fetchSentimentExtremesMock.mockResolvedValue({
      from: '1912-01-15',
      to: '1912-12-10',
      positiveTotal: 1,
      negativeTotal: 0,
      limit: 5,
      positiveOffset: 0,
      negativeOffset: 0,
      mostPositive: [
        {
          documentId: 'doc-1912-jun',
          title: '1912 June rally speech',
          date: '1912-06-18',
          polarity: 0.7,
          label: 'positive',
        },
      ],
      mostNegative: [],
    });
  });

  afterEach(() => {
    fetchSentimentExtremesMock.mockReset();
    fetchSentimentRangeMock.mockReset();
    fetchSentimentTimelineMock.mockReset();
  });

  it('narrows and clears the below-graph lists when a month node is clicked', async () => {
    renderPage();

    await waitFor(() => {
      expect(fetchSentimentExtremesMock).toHaveBeenLastCalledWith({
        from: '1912-01-15',
        to: '1912-12-10',
        limit: 5,
        positiveOffset: 0,
        negativeOffset: 0,
      });
    });

    fireEvent.click(await screen.findByRole('button', { name: /show documents for 1912-06/i }));

    await waitFor(() => {
      expect(fetchSentimentExtremesMock).toHaveBeenLastCalledWith({
        from: '1912-06-01',
        to: '1912-06-30',
        limit: 5,
        positiveOffset: 0,
        negativeOffset: 0,
      });
    });
    expect(screen.getByText(/showing documents for 1912-06/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /show documents for 1912-06/i }));

    await waitFor(() => {
      expect(fetchSentimentExtremesMock).toHaveBeenLastCalledWith({
        from: '1912-01-15',
        to: '1912-12-10',
        limit: 5,
        positiveOffset: 0,
        negativeOffset: 0,
      });
    });
  });

  it('supports keyboard selection and clears selection when date filters change', async () => {
    renderPage();

    const januaryNode = await screen.findByRole('button', { name: /show documents for 1912-01/i });
    fireEvent.keyDown(januaryNode, { key: 'Enter' });

    await waitFor(() => {
      expect(fetchSentimentExtremesMock).toHaveBeenLastCalledWith({
        from: '1912-01-15',
        to: '1912-01-31',
        limit: 5,
        positiveOffset: 0,
        negativeOffset: 0,
      });
    });

    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: '1912-02-01' } });

    await waitFor(() => {
      expect(fetchSentimentExtremesMock).toHaveBeenLastCalledWith({
        from: '1912-02-01',
        to: '1912-12-10',
        limit: 5,
        positiveOffset: 0,
        negativeOffset: 0,
      });
    });
    expect(screen.queryByText(/showing documents for 1912-01/i)).toBeNull();
  });

  it('loads more positive and negative extremes independently', async () => {
    fetchSentimentExtremesMock
      .mockResolvedValueOnce({
        from: '1912-01-15',
        to: '1912-12-10',
        positiveTotal: 6,
        negativeTotal: 6,
        limit: 5,
        positiveOffset: 0,
        negativeOffset: 0,
        mostPositive: Array.from({ length: 5 }, (_, i) => makeExtreme(`pos-${i}`, 0.7 - i / 10)),
        mostNegative: Array.from({ length: 5 }, (_, i) => makeExtreme(`neg-${i}`, -0.7 + i / 10)),
      })
      .mockResolvedValueOnce({
        from: '1912-01-15',
        to: '1912-12-10',
        positiveTotal: 6,
        negativeTotal: 6,
        limit: 5,
        positiveOffset: 5,
        negativeOffset: 0,
        mostPositive: [makeExtreme('pos-5', 0.1)],
        mostNegative: Array.from({ length: 5 }, (_, i) => makeExtreme(`neg-${i}`, -0.7 + i / 10)),
      })
      .mockResolvedValueOnce({
        from: '1912-01-15',
        to: '1912-12-10',
        positiveTotal: 6,
        negativeTotal: 6,
        limit: 5,
        positiveOffset: 5,
        negativeOffset: 5,
        mostPositive: [makeExtreme('pos-5', 0.1)],
        mostNegative: [makeExtreme('neg-5', -0.1)],
      });

    renderPage();

    await screen.findByRole('button', { name: /load more positive/i });
    fireEvent.click(screen.getByRole('button', { name: /load more positive/i }));

    await waitFor(() => {
      expect(fetchSentimentExtremesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ positiveOffset: 5, negativeOffset: 0 }),
      );
    });
    expect(await screen.findByText('Document pos-5')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /load more negative/i }));
    await waitFor(() => {
      expect(fetchSentimentExtremesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ positiveOffset: 5, negativeOffset: 5 }),
      );
    });
    expect(await screen.findByText('Document neg-5')).toBeTruthy();
  });
});
