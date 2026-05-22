import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicsPage } from './TopicsPage';

const { fetchTopicDriftMock, fetchTopicMock, fetchTopicsMock } = vi.hoisted(() => ({
  fetchTopicDriftMock: vi.fn(),
  fetchTopicMock: vi.fn(),
  fetchTopicsMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  fetchTopic: fetchTopicMock,
  fetchTopicDrift: fetchTopicDriftMock,
  fetchTopics: fetchTopicsMock,
}));

function renderPage(initialPath = '/topics') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/topics" element={<TopicsPage />} />
          <Route path="/topics/:id" element={<TopicsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockTopicDetail(id = 'Governors--New York (State)') {
  fetchTopicMock.mockResolvedValue({
    topic: { id, label: id, size: 12 },
    total: 12,
    limit: 25,
    offset: 0,
    members: [
      {
        documentId: 'doc-1',
        title: 'A letter from Albany',
        date: '1903-01-01',
      },
    ],
  });
}

function makeMember(i: number) {
  return {
    documentId: `doc-${i}`,
    title: `Topic document ${i}`,
    date: '1903-01-01',
  };
}

describe('TopicsPage', () => {
  beforeEach(() => {
    fetchTopicDriftMock.mockReset();
    fetchTopicMock.mockReset();
    fetchTopicsMock.mockReset();
  });

  it('renders count bars, share line, and summary stats for a topic', async () => {
    mockTopicDetail();
    fetchTopicDriftMock.mockResolvedValue({
      points: [
        { topicId: 'Governors--New York (State)', period: '1900', documentCount: 4, share: 0.25 },
        { topicId: 'other', period: '1901', documentCount: 10, share: 1 },
        { topicId: 'Governors--New York (State)', period: '1902', documentCount: 4, share: 0.25 },
        { topicId: 'Governors--New York (State)', period: '1903', documentCount: 4, share: 0.25 },
      ],
    });

    renderPage(`/topics/${encodeURIComponent('Governors--New York (State)')}`);

    expect(
      await screen.findByRole('img', { name: /topic document count and corpus share/i }),
    ).toBeTruthy();
    expect(screen.getByText(/Peak year/i)).toBeTruthy();
    expect(screen.getByText(/1900 \(4 docs\)/i)).toBeTruthy();
    expect(screen.getByText(/Peak share/i)).toBeTruthy();
    expect(screen.getByText(/Total in chart/i)).toBeTruthy();
    expect(screen.getAllByText(/12 documents/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Active years/i)).toBeTruthy();
  });

  it('fills missing corpus years with zero-count topic points', async () => {
    mockTopicDetail();
    fetchTopicDriftMock.mockResolvedValue({
      points: [
        { topicId: 'Governors--New York (State)', period: '1900', documentCount: 4, share: 0.25 },
        { topicId: 'other', period: '1901', documentCount: 10, share: 1 },
        { topicId: 'Governors--New York (State)', period: '1902', documentCount: 4, share: 0.25 },
        { topicId: 'Governors--New York (State)', period: '1903', documentCount: 4, share: 0.25 },
      ],
    });

    renderPage(`/topics/${encodeURIComponent('Governors--New York (State)')}`);

    await waitFor(() => {
      expect(screen.getAllByText('1901: 0 docs, 0% share').length).toBeGreaterThan(0);
    });
  });

  it('shows a data-quality note for near-constant share on a sizable topic', async () => {
    mockTopicDetail();
    fetchTopicDriftMock.mockResolvedValue({
      points: [
        { topicId: 'Governors--New York (State)', period: '1900', documentCount: 4, share: 0.25 },
        { topicId: 'Governors--New York (State)', period: '1901', documentCount: 4, share: 0.25 },
        { topicId: 'Governors--New York (State)', period: '1902', documentCount: 4, share: 0.25 },
      ],
    });

    renderPage(`/topics/${encodeURIComponent('Governors--New York (State)')}`);

    expect(await screen.findByText(/nearly constant share/i)).toBeTruthy();
  });

  it('does not show the flat-data note for a varied series', async () => {
    mockTopicDetail('progressive');
    fetchTopicDriftMock.mockResolvedValue({
      points: [
        { topicId: 'progressive', period: '1900', documentCount: 2, share: 0.1 },
        { topicId: 'progressive', period: '1901', documentCount: 4, share: 0.2 },
        { topicId: 'progressive', period: '1902', documentCount: 6, share: 0.35 },
      ],
    });

    renderPage('/topics/progressive');

    await screen.findByRole('img', { name: /topic document count and corpus share/i });
    expect(screen.queryByText(/nearly constant share/i)).toBeNull();
  });

  it('renders compact trend labels in the topic grid', async () => {
    fetchTopicsMock.mockResolvedValue({
      items: [
        { id: 'flat-topic', label: 'Flat topic', size: 12 },
        { id: 'rising-topic', label: 'Rising topic', size: 9 },
      ],
      total: 2,
    });
    fetchTopicDriftMock.mockResolvedValue({
      points: [
        { topicId: 'flat-topic', period: '1900', documentCount: 4, share: 0.25 },
        { topicId: 'rising-topic', period: '1900', documentCount: 1, share: 0.1 },
        { topicId: 'flat-topic', period: '1901', documentCount: 4, share: 0.25 },
        { topicId: 'rising-topic', period: '1901', documentCount: 3, share: 0.2 },
        { topicId: 'flat-topic', period: '1902', documentCount: 4, share: 0.25 },
        { topicId: 'rising-topic', period: '1902', documentCount: 5, share: 0.4 },
      ],
    });

    renderPage();

    expect(await screen.findByText('Flat topic')).toBeTruthy();
    expect(screen.getByText('Rising topic')).toBeTruthy();
    expect(screen.getByText('flat')).toBeTruthy();
    expect(screen.getByText('rising')).toBeTruthy();
  });

  it('keeps the empty topics state intact', async () => {
    fetchTopicsMock.mockResolvedValue({ items: [], total: 0 });
    fetchTopicDriftMock.mockResolvedValue({ points: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/No topics yet/i)).toBeTruthy();
    });
  });

  it('appends topic members with Load more', async () => {
    fetchTopicMock
      .mockResolvedValueOnce({
        topic: { id: 'progressive', label: 'progressive', size: 26 },
        total: 26,
        limit: 25,
        offset: 0,
        members: Array.from({ length: 25 }, (_, i) => makeMember(i)),
      })
      .mockResolvedValueOnce({
        topic: { id: 'progressive', label: 'progressive', size: 26 },
        total: 26,
        limit: 25,
        offset: 25,
        members: [makeMember(25)],
      });
    fetchTopicDriftMock.mockResolvedValue({
      points: [{ topicId: 'progressive', period: '1900', documentCount: 26, share: 1 }],
    });

    renderPage('/topics/progressive');

    await waitFor(() => {
      expect(screen.getAllByText(/Showing 25 of 26/i).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => {
      expect(fetchTopicMock).toHaveBeenLastCalledWith('progressive', { limit: 25, offset: 25 });
    });
    await waitFor(() => {
      expect(screen.getAllByText(/Showing 26 of 26/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });
});
