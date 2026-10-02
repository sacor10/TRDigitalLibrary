import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useIsMobile } from '../hooks/useIsMobile';

import { MoonIcon, SunIcon } from './icons';
import { MobileLayout } from './mobile/MobileLayout';
import { NavMenu, type NavMenuItem } from './NavMenu';
import { SignInButton } from './SignInButton';

const PRIMARY = [
  { to: '/browse', label: 'Browse' },
  { to: '/search', label: 'Search' },
];

const DISCOVER: NavMenuItem[] = [
  { to: '/periods', label: 'Periods' },
  { to: '/essays', label: 'Essays' },
];

const ANALYZE: NavMenuItem[] = [
  { to: '/timeline', label: 'Timeline' },
  { to: '/network', label: 'Network' },
  { to: '/topics', label: 'Topics' },
  { to: '/sentiment', label: 'Sentiment' },
];

const primaryLinkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md border-b-2 px-3 py-2 hover:bg-parchment-200/60 dark:hover:bg-ink-700 ${
    isActive ? 'border-accent-500 font-semibold text-accent-500' : 'border-transparent'
  }`;

export function Layout({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const isMobile = useIsMobile();

  if (isMobile) {
    return <MobileLayout>{children}</MobileLayout>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 border-b border-ink-700/10 bg-parchment-100/90 backdrop-blur dark:border-parchment-50/10 dark:bg-ink-800/90">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <NavLink
            to="/"
            className="flex min-w-0 shrink-0 items-baseline gap-2 text-base font-semibold tracking-tight sm:text-lg"
          >
            <span className="text-accent-500">TR</span>
            <span className="hidden truncate lg:inline">Digital Library</span>
          </NavLink>
          <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
            {PRIMARY.map((item) => (
              <NavLink key={item.to} to={item.to} className={primaryLinkClass}>
                {item.label}
              </NavLink>
            ))}
            <NavMenu label="Discover" items={DISCOVER} />
            <NavMenu label="Analyze" items={ANALYZE} />
          </nav>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-2 border-l border-ink-700/10 pl-3 text-sm dark:border-parchment-50/10">
            {user && (
              <NavLink to="/lists" className={primaryLinkClass}>
                My lists
              </NavLink>
            )}
            <button
              type="button"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="btn !min-h-0 !px-2 !py-2"
            >
              {theme === 'dark' ? (
                <SunIcon width={18} height={18} />
              ) : (
                <MoonIcon width={18} height={18} />
              )}
            </button>
            <SignInButton />
          </div>
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
