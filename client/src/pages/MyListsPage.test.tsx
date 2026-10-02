import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Collection } from '@tr/shared';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyListsPage } from './MyListsPage';

const { fetchCollectionsMock, createCollectionMock } = vi.hoisted(() => ({
  fetchCollectionsMock: vi.fn(),
  createCollectionMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  fetchCollections: fetchCollectionsMock,
  createCollection: createCollectionMock,
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'TR', email: 'tr@example.com' },
    loading: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

function makeCollection(id: string, title: string): Collection {
  return {
    id,
    title,
    description: null,
    isPublic: false,
    ownerName: 'TR',
    itemCount: 0,
    createdAt: '1900-01-01T00:00:00.000Z',
    modifiedAt: '1900-01-01T00:00:00.000Z',
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MyListsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MyListsPage create list', () => {
  beforeEach(() => {
    fetchCollectionsMock.mockReset();
    createCollectionMock.mockReset();
    fetchCollectionsMock.mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    fetchCollectionsMock.mockReset();
    createCollectionMock.mockReset();
  });

  it('shows an on-page message and does not call the API when the name is empty', async () => {
    renderPage();

    // The button is clickable (not disabled) even with an empty input.
    const button = screen.getByRole('button', { name: /create list/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);

    expect(await screen.findByText(/enter a list name/i)).toBeTruthy();
    expect(createCollectionMock).not.toHaveBeenCalled();
  });

  it('creates a list with the trimmed title and clears the input on success', async () => {
    createCollectionMock.mockResolvedValue(makeCollection('c1', 'Spanish War'));

    renderPage();

    const input = screen.getByLabelText(/new list name/i);
    fireEvent.change(input, { target: { value: '  Spanish War  ' } });
    fireEvent.click(screen.getByRole('button', { name: /create list/i }));

    await waitFor(() => {
      expect(createCollectionMock).toHaveBeenCalledWith({ title: 'Spanish War' });
    });
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('');
    });
  });

  it('shows the failure message on the page when creation fails', async () => {
    createCollectionMock.mockRejectedValue(new Error('Server is down'));

    renderPage();

    fireEvent.change(screen.getByLabelText(/new list name/i), {
      target: { value: 'My list' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create list/i }));

    expect(await screen.findByText('Server is down')).toBeTruthy();
  });
});
