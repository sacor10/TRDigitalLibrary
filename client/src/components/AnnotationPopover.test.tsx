import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Annotation, AuthUser } from '@tr/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnotationPopover } from './AnnotationPopover';

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    loading: false,
    signIn: async () => {},
    signOut: async () => {},
  }),
}));

const author: AuthUser = {
  id: 'user-a',
  email: 'a@example.org',
  name: 'User A',
  pictureUrl: null,
};

const otherUser: AuthUser = {
  id: 'user-b',
  email: 'b@example.org',
  name: 'User B',
  pictureUrl: null,
};

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'anno-1',
    type: 'Annotation',
    motivation: 'commenting',
    body: [
      {
        type: 'TextualBody',
        value: 'Original note',
        format: 'text/plain',
        purpose: 'commenting',
      },
    ],
    target: {
      source: 'urn:tr-digital-library:document:doc-1',
      selector: {
        type: 'TextQuoteSelector',
        exact: 'selected text',
      },
    },
    creator: {
      id: author.id,
      type: 'Person',
      name: author.name,
    },
    created: '2024-01-01T00:00:00.000Z',
    modified: '2024-01-01T00:00:00.000Z',
    documentId: 'doc-1',
    sectionId: null,
    ...overrides,
  };
}

function renderPopover(annotation = makeAnnotation()) {
  const onClose = vi.fn();
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const onPatch = vi.fn().mockResolvedValue(undefined);
  return {
    onClose,
    onDelete,
    onPatch,
    ...render(
      <AnnotationPopover
        annotation={annotation}
        onClose={onClose}
        onDelete={onDelete}
        onPatch={onPatch}
      />,
    ),
  };
}

describe('AnnotationPopover actions', () => {
  beforeEach(() => {
    auth.user = author;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('lets the author edit note text', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <AnnotationPopover
        annotation={makeAnnotation()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onPatch={onPatch}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText(/annotation note/i), {
      target: { value: 'Updated note' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith('anno-1', {
        motivation: 'commenting',
        bodyText: 'Updated note',
      });
    });
  });

  it('lets the author convert between note and highlight annotation types', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <AnnotationPopover
        annotation={makeAnnotation()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onPatch={onPatch}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.click(screen.getByLabelText(/highlight only/i));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onPatch).toHaveBeenLastCalledWith('anno-1', {
        motivation: 'highlighting',
      });
    });

    rerender(
      <AnnotationPopover
        annotation={makeAnnotation({ motivation: 'highlighting', body: undefined })}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onPatch={onPatch}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    fireEvent.click(screen.getByLabelText(/^note$/i));
    fireEvent.change(screen.getByLabelText(/annotation note/i), {
      target: { value: 'Converted note' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(onPatch).toHaveBeenLastCalledWith('anno-1', {
        motivation: 'commenting',
        bodyText: 'Converted note',
      });
    });
  });

  it('lets the author remove an annotation', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <AnnotationPopover
        annotation={makeAnnotation()}
        onClose={vi.fn()}
        onDelete={onDelete}
        onPatch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
      expect(onDelete).toHaveBeenCalledWith('anno-1');
    });
  });

  it('hides edit and remove controls from non-authors', () => {
    auth.user = otherUser;

    renderPopover();

    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('falls back to copying the public annotation URL when native share is unavailable', async () => {
    renderPopover();

    fireEvent.click(screen.getByRole('button', { name: /share/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/annotations/anno-1`,
      );
      expect(screen.getByText(/copied public annotation link/i)).not.toBeNull();
    });
  });
});
