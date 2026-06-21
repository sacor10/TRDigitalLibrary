import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { MobileTabBar } from './MobileTabBar';

export function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="safe-top sticky top-0 z-30 border-b border-ink-700/10 bg-parchment-100/90 backdrop-blur dark:border-parchment-50/10 dark:bg-ink-800/90">
        <div className="flex h-12 items-center px-4">
          <NavLink to="/" className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
            <span className="text-accent-500">TR</span>
            <span>Digital Library</span>
          </NavLink>
        </div>
      </header>
      <main id="main" className="pb-safe-tabbar w-full flex-1 px-4 py-5">
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
