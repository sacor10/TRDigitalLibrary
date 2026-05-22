import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Document } from '@tr/shared';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TranscriptionPane } from './TranscriptionPane';

const { listDocumentAnnotationsMock } = vi.hoisted(() => ({
  listDocumentAnnotationsMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  createAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
  listDocumentAnnotations: listDocumentAnnotationsMock,
  patchAnnotation: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signIn: async () => {},
    signOut: async () => {},
  }),
}));

function makeDocument(transcription: string): Document {
  return {
    id: 'doc-1',
    title: 'Test document',
    type: 'letter',
    date: '1900-01-01',
    recipient: null,
    location: null,
    author: 'Theodore Roosevelt',
    transcription,
    transcriptionUrl: null,
    transcriptionFormat: 'plain-text',
    facsimileUrl: null,
    iiifManifestUrl: null,
    provenance: null,
    source: 'test',
    sourceUrl: 'https://example.org/doc-1',
    tags: [],
    mentions: [],
    teiXml: null,
  };
}

function renderPane(document: Document) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TranscriptionPane document={document} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TranscriptionPane progressive disclosure', () => {
  beforeEach(() => {
    listDocumentAnnotationsMock.mockResolvedValue({ items: [], total: 0 });
  });

  it('renders short transcriptions fully without a show more control', () => {
    const text = 'A short transcription.\n\nIt has a second paragraph.';

    const { container } = renderPane(makeDocument(text));

    expect(container.textContent).toContain('A short transcription.');
    expect(container.textContent).toContain('It has a second paragraph.');
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('renders only the first 500 words for long transcriptions until expanded', () => {
    const words = Array.from({ length: 620 }, (_, i) => `word${i}`);
    const text = words.join(' ');

    const { container } = renderPane(makeDocument(text));

    expect(container.textContent).toContain('word0');
    expect(container.textContent).toContain('word499');
    expect(container.textContent).not.toContain('word500');
    expect(container.textContent).not.toContain('word619');
    expect(screen.getByRole('button', { name: /show more/i })).not.toBeNull();
  });

  it('reveals the rest of a long transcription when show more is clicked', () => {
    const words = Array.from({ length: 620 }, (_, i) => `word${i}`);
    const text = words.join(' ');

    const { container } = renderPane(makeDocument(text));

    fireEvent.click(screen.getByRole('button', { name: /show more/i }));

    expect(container.textContent).toContain('word500');
    expect(container.textContent).toContain('word619');
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });

  it('keeps the no-transcription fallback unchanged', () => {
    renderPane(makeDocument(''));

    expect(screen.getByText(/no cached transcription is available/i)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'https://example.org/doc-1' })).not.toBeNull();
  });
});
