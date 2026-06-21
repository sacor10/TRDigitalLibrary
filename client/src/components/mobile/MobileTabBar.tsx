import { type ComponentType, type SVGProps, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { HomeIcon, ListsIcon, MoreIcon, SearchIcon } from './icons';
import { MoreSheet } from './MoreSheet';

type TabIcon = ComponentType<SVGProps<SVGSVGElement>>;

const TABS: Array<{ to: string; label: string; icon: TabIcon; end?: boolean }> = [
  { to: '/', label: 'Home', icon: HomeIcon, end: true },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/lists', label: 'Lists', icon: ListsIcon },
];

const itemClass =
  'tap flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium';

export function MobileTabBar() {
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <>
      <nav
        aria-label="Primary"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-ink-700/10 bg-parchment-100/95 backdrop-blur dark:border-parchment-50/10 dark:bg-ink-800/95"
      >
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            className={({ isActive }) =>
              `${itemClass} ${
                isActive
                  ? 'text-accent-500'
                  : 'text-ink-700/70 dark:text-parchment-100/70'
              }`
            }
          >
            <Icon width={24} height={24} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={`${itemClass} ${
            moreOpen ? 'text-accent-500' : 'text-ink-700/70 dark:text-parchment-100/70'
          }`}
        >
          <MoreIcon width={24} height={24} />
          <span>More</span>
        </button>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
