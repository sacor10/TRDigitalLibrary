import { useEffect, useState } from 'react';

// Phones only. 768px+ keeps the responsive desktop layout. Tunable here.
export const MOBILE_QUERY = '(max-width: 767px)';

function getMatch(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

/** Returns true on phone-width viewports, subscribing to changes. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent): void => setIsMobile(e.matches);
    // Sync in case the viewport changed between render and effect.
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
