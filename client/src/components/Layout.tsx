import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { useTheme } from '../context/ThemeContext';
import { SignInButton } from './SignInButton';

const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/browse', label: 'Browse' },
  { to: '/search', label: 'Search' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/network', label: 'Network' },
  { to: '/topics', label: 'Topics' },
  { to: '/sentiment', label: 'Sentiment' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 border-b border-ink-700/10 bg-parchment-100/90 backdrop-blur dark:border-parchment-50/10 dark:bg-ink-800/90">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full items-center justify-between gap-3 lg:w-auto">
            <NavLink
              to="/"
              className="flex min-w-0 items-baseline gap-2 text-base font-semibold tracking-tight sm:text-lg"
            >
              <span className="text-accent-500">TR</span>
              <span className="truncate">Digital Library</span>
            </NavLink>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={toggle}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                className="btn"
              >
                {theme === 'dark' ? 'Light' : 'Dark'}
              </button>
              <SignInButton />
            </div>
          </div>
          <nav
            aria-label="Primary"
            className="-mx-4 overflow-x-auto px-4 pb-1 text-sm lg:mx-0 lg:px-0 lg:pb-0"
          >
            <div className="flex min-w-max items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end ?? false}
                  className={({ isActive }) =>
                    `whitespace-nowrap rounded-md px-3 py-2 hover:bg-parchment-200/60 dark:hover:bg-ink-700 ${
                      isActive ? 'bg-parchment-200 dark:bg-ink-700 font-medium' : ''
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        {children}
      </main>
      <footer className="border-t border-ink-700/10 dark:border-parchment-50/10 mt-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-ink-700/80 dark:text-parchment-50/70 sm:flex-row sm:flex-wrap sm:justify-between sm:gap-4">
          <span>Public-domain content sourced from Wikisource and the Library of Congress.</span>
          <span>Code MIT &middot; Content CC BY 4.0 where applicable</span>
        </div>
      </footer>
    </div>
  );
}
