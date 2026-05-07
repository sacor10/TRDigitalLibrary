import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { useTheme } from '../context/ThemeContext';

const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/browse', label: 'Browse' },
  { to: '/search', label: 'Search' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/network', label: 'Network' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="border-b border-ink-700/10 dark:border-parchment-50/10 bg-parchment-100/80 dark:bg-ink-800/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <NavLink to="/" className="font-semibold tracking-tight text-lg flex items-baseline gap-2">
            <span className="text-accent-500">TR</span>
            <span>Digital Library</span>
          </NavLink>
          <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md hover:bg-parchment-200/60 dark:hover:bg-ink-700 ${
                    isActive ? 'bg-parchment-200 dark:bg-ink-700 font-medium' : ''
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <button
              type="button"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="btn ml-2"
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
        {children}
      </main>
      <footer className="border-t border-ink-700/10 dark:border-parchment-50/10 mt-12">
        <div className="max-w-6xl mx-auto px-4 py-6 text-sm text-ink-700/80 dark:text-parchment-50/70 flex flex-wrap gap-4 justify-between">
          <span>
            Public-domain content sourced from Wikisource and the Library of Congress.
          </span>
          <span>
            Code MIT &middot; Content CC BY 4.0 where applicable
          </span>
        </div>
      </footer>
    </div>
  );
}
