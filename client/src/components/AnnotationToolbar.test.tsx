import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AnnotationCreateInput, AuthUser } from '@tr/shared';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnotationToolbar } from './AnnotationToolbar';

const auth = vi.hoisted(() => ({
  user: null as AuthUser | null,
}));

const selectionApi = vi.hoisted(() => ({
  capture: {
    startOffset: 0,
    endOffset: 13,
    exact: 'selected text',
    prefix: '',
    suffix: '',
  },
  target: {
    source: 'urn:tr-digital-library:document:doc-1',
    selector: [{ type: 'TextQuoteSelector' as const, exact: 'selected text' }],
  },
  captureSelectionWithin: vi.fn(),
  captureSelectionToTarget: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    loading: false,
    signIn: async () => {},
    signOut: async () => {},
  }),
}));

vi.mock('../lib/selection', () => ({
  captureSelectionWithin: selectionApi.captureSelectionWithin,
  captureSelectionToTarget: selectionApi.captureSelectionToTarget,
}));

const user: AuthUser = {
  id: 'user-a',
  email: 'a@example.org',
  name: 'User A',
  pictureUrl: null,
};

function rect(init: Partial<DOMRect>): DOMRect {
  return {
    x: init.left ?? 0,
    y: init.top ?? 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...init,
  };
}

function ToolbarHost({
  onSave = vi.fn(),
}: {
  onSave?: (input: AnnotationCreateInput) => Promise<void>;
}) {
  const rootRef = useRef<HTMLElement>(null);

  return (
    <div data-testid="toolbar-container">
      <article ref={rootRef}>selected text</article>
      <AnnotationToolbar documentId="doc-1" rootRef={rootRef} onSave={onSave} />
    </div>
  );
}

describe('AnnotationToolbar', () => {
  beforeEach(() => {
    auth.user = user;
    vi.restoreAllMocks();
    selectionApi.captureSelectionWithin.mockReturnValue(selectionApi.capture);
    selectionApi.captureSelectionToTarget.mockReturnValue(selectionApi.target);
  });

  it('positions the toolbar relative to its container instead of page coordinates', async () => {
    const range = {
      getBoundingClientRect: () => rect({ left: 220, top: 150, width: 80 }),
    };
    const selection = {
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

    render(<ToolbarHost />);

    screen.getByTestId('toolbar-container').getBoundingClientRect = () =>
      rect({ left: 100, top: 40, width: 400 });

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const toolbar = await screen.findByRole('toolbar', { name: /annotation toolbar/i });

    expect(toolbar.style.left).toBe('160px');
    expect(toolbar.style.top).toBe('62px');
  });

  it('keeps the note editor open when focusing it clears the document selection', async () => {
    const range = {
      getBoundingClientRect: () => rect({ left: 220, top: 150, width: 80 }),
    };
    const selection = {
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

    render(<ToolbarHost />);

    screen.getByTestId('toolbar-container').getBoundingClientRect = () =>
      rect({ left: 100, top: 40, width: 400 });

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    fireEvent.click(await screen.findByRole('button', { name: /add note/i }));

    selectionApi.captureSelectionWithin.mockReturnValue(null);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(screen.getByPlaceholderText(/add a scholarly note/i)).not.toBeNull();
  });

  it('saves a note with the preserved selection target and trimmed body text', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const removeAllRanges = vi.fn();
    const range = {
      getBoundingClientRect: () => rect({ left: 220, top: 150, width: 80 }),
    };
    const selection = {
      getRangeAt: () => range,
      removeAllRanges,
    };
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection);

    render(<ToolbarHost onSave={onSave} />);

    screen.getByTestId('toolbar-container').getBoundingClientRect = () =>
      rect({ left: 100, top: 40, width: 400 });

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    fireEvent.click(await screen.findByRole('button', { name: /add note/i }));
    fireEvent.change(screen.getByPlaceholderText(/add a scholarly note/i), {
      target: { value: '  A useful note.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        documentId: 'doc-1',
        sectionId: null,
        motivation: 'commenting',
        target: selectionApi.target,
        bodyText: 'A useful note.',
      });
    });
    expect(removeAllRanges).toHaveBeenCalled();
  });
});
