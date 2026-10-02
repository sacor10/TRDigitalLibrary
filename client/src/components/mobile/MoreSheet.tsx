import { NavLink } from 'react-router-dom';

import { useTheme } from '../../context/ThemeContext';
import { SignInButton } from '../SignInButton';

import { BottomSheet } from './BottomSheet';

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS: Array<{ heading: string; items: Array<{ to: string; label: string }> }> = [
  {
    heading: 'Discover',
    items: [
      { to: '/browse', label: 'Browse the collection' },
      { to: '/periods', label: 'Life periods' },
      { to: '/essays', label: 'Essays' },
    ],
  },
  {
    heading: 'Analyze',
    items: [
      { to: '/timeline', label: 'Timeline' },
      { to: '/network', label: 'Correspondent network' },
      { to: '/topics', label: 'Topics' },
      { to: '/sentiment', label: 'Sentiment' },
    ],
  },
];

export function MoreSheet({ open, onClose }: MoreSheetProps) {
  const { theme, toggle } = useTheme();
  return (
    <BottomSheet open={open} onClose={onClose} title="More">
      <nav aria-label="More destinations" className="space-y-5">
        {GROUPS.map((group) => (
          <div key={group.heading}>
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-ink-700/60 dark:text-parchment-100/60">
              {group.heading}
            </p>
            <ul className="overflow-hidden rounded-xl border border-ink-700/10 dark:border-parchment-50/10">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `tap flex min-h-12 items-center px-4 py-3 text-base hover:bg-parchment-200/50 dark:hover:bg-ink-700/60 ${
                        isActive ? 'font-semibold text-accent-500' : ''
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-ink-700/10 pt-5 dark:border-parchment-50/10">
        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          className="btn tap"
        >
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <SignInButton />
      </div>
    </BottomSheet>
  );
}
