import { useEffect, useLayoutEffect, useRef } from 'react';

import { useAuth } from '../auth/AuthContext';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
  }) => void;
  cancel?: () => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'small' | 'medium' | 'large';
      text?: 'signin_with' | 'signup_with' | 'continue_with';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
    },
  ) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Failed to load Google Identity Services')),
      );
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function dismissGoogleIdentityUi(host: HTMLElement | null) {
  window.google?.accounts?.id?.cancel?.();
  host?.replaceChildren();
}

export function SignInButton() {
  const { user, loading, signIn, signOut } = useAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

  useLayoutEffect(() => {
    if (user) {
      dismissGoogleIdentityUi(null);
    }
  }, [user]);

  useEffect(() => {
    if (user || loading) return;
    if (!clientId) return;
    const host = containerRef.current;
    if (!host) return;

    let cancelled = false;
    loadGisScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            void signIn(response.credential).catch((err: unknown) => {
              console.error('Google sign-in failed', err);
            });
          },
          auto_select: false,
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'medium',
          text: 'signin_with',
          shape: 'pill',
        });
      })
      .catch((err: unknown) => {
        console.error('GIS load failed', err);
      });

    return () => {
      cancelled = true;
      dismissGoogleIdentityUi(host);
    };
  }, [user, loading, clientId, signIn]);

  if (loading) {
    return <span className="text-sm text-ink-700/60 dark:text-parchment-50/60">…</span>;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        {user.pictureUrl && (
          <img
            src={user.pictureUrl}
            alt=""
            className="h-7 w-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="hidden sm:inline" title={user.email}>
          {user.name}
        </span>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          className="btn"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (!clientId) {
    return (
      <span
        className="hidden text-xs text-ink-700/60 dark:text-parchment-50/60 sm:inline"
        title="Set VITE_GOOGLE_CLIENT_ID to enable sign-in"
      >
        Sign-in disabled
      </span>
    );
  }

  return <div ref={containerRef} aria-label="Sign in with Google" />;
}
