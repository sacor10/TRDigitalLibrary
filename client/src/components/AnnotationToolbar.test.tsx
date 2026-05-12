import { act, render, screen } from '@testing-library/react';
import type { AuthUser } from '@tr/shared';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnotationToolbar } from './AnnotationToolbar';

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

const selectionCapture = {
  startOffset: 0,
  endOffset: 13,
  exact: 'selected text',
  prefix: '',
  suffix: '',
};

vi.mock('../lib/selection', () => ({
  captureSelectionWithin: vi.fn(() => selectionCapture),
  captureSelectionToTarget: vi.fn(() => ({
    source: 'urn:tr-digital-library:document:doc-1',
    selector: [{ type: 'TextQuoteSelector', exact: selectionCapture.exact }],
  })),
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

function ToolbarHost() {
  const rootRef = useRef<HTMLElement>(null);

  return (
    <div data-testid="toolbar-container">
      <article ref={rootRef}>selected text</article>
      <AnnotationToolbar documentId="doc-1" rootRef={rootRef} onSave={vi.fn()} />
    </div>
  );
}

describe('AnnotationToolbar', () => {
  beforeEach(() => {
    auth.user = user;
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
});
