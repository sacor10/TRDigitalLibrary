import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LoadingModal } from './LoadingModal';

describe('LoadingModal', () => {
  it('renders an accessible loading status with the provided message', () => {
    render(<LoadingModal message="Loading documents..." />);

    const status = screen.getByRole('status', { name: 'Loading documents...' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('Loading documents...');
  });

  it('renders a spinner that is hidden from assistive technology', () => {
    render(<LoadingModal message="Loading documents..." />);

    const spinner = screen.getByTestId('loading-spinner');
    expect(spinner.getAttribute('aria-hidden')).toBe('true');
  });
});
