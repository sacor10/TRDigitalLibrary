import type { AuthUser } from '@tr/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';


import { fetchMe, googleSignIn, logout as apiLogout } from '../api/client';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  signIn: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  /** Avoids initial GET /me (401, no cookie yet) overwriting state after a fast Google sign-in. */
  const signInCompletedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((u) => {
        if (!cancelled) {
          if (u !== null) {
            setUser(u);
          } else if (!signInCompletedRef.current) {
            setUser(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled && !signInCompletedRef.current) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (idToken: string) => {
    signInCompletedRef.current = true;
    const u = await googleSignIn(idToken);
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    signInCompletedRef.current = false;
    await apiLogout();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
