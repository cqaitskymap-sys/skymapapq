'use client';

import {
  createContext, useCallback, useContext, useEffect, useState, ReactNode,
} from 'react';
import type { User } from 'firebase/auth';
import type { Profile } from '@/lib/firebase';
import { FirebaseNotConfiguredError } from '@/lib/firebase-config';
import { clearAuthSessionCookies } from '@/lib/auth-session-cookies';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, role: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function syncAuthSessionCookie(user: User) {
  if (typeof document === 'undefined') return;
  const token = await user.getIdToken();
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = 'firebase-auth-session=; path=/; max-age=0; SameSite=Lax';
  document.cookie = `__session=${token}; path=/; max-age=${60 * 60}; SameSite=Lax${secure}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    try {
      const { getUserProfile } = await import('@/lib/auth');
      const data = await getUserProfile(userId);
      setProfile(data ?? null);
    } catch (error) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.uid);
  };

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const safetyTimer = window.setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 8000);

    void (async () => {
      try {
        const { isFirebaseConfigured } = await import('@/lib/firebase-config');
        if (!isFirebaseConfigured()) {
          if (!cancelled) setLoading(false);
          return;
        }

        if (cancelled) return;

        const { subscribeToAuthState } = await import('@/lib/auth');
        unsubscribe = subscribeToAuthState((currentUser) => {
          void (async () => {
            setUser(currentUser ?? null);
            if (currentUser) {
              void syncAuthSessionCookie(currentUser).catch(() => clearAuthSessionCookies());
              await fetchProfile(currentUser.uid);
            } else {
              clearAuthSessionCookies();
              setProfile(null);
            }
            if (!cancelled) setLoading(false);
          })();
        });
      } catch (error) {
        console.error('Firebase auth init failed:', error);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
      unsubscribe?.();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { signIn: firebaseSignIn, isFirebaseConfigured } = await import('@/lib/auth');

    if (!isFirebaseConfigured()) {
      return {
        error: new Error(
          'Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* environment variables and restart the application.',
        ),
      };
    }

    try {
      const signedInUser = await firebaseSignIn(email, password);
      await syncAuthSessionCookie(signedInUser);
      await fetchProfile(signedInUser.uid);
      return { error: null };
    } catch (error) {
      if (error instanceof FirebaseNotConfiguredError || (error as Error)?.name === 'FirebaseNotConfiguredError') {
        return {
          error: new Error(
            'Firebase is not configured. Add NEXT_PUBLIC_FIREBASE_* environment variables and restart the application.',
          ),
        };
      }
      return { error: new Error((await import('@/lib/auth')).formatAuthError(error)) };
    }
  };

  const signUp = async (email: string, password: string, fullName: string, role: string) => {
    try {
      const { signUp: firebaseSignUp, isFirebaseConfigured } = await import('@/lib/auth');
      if (!isFirebaseConfigured()) {
        return {
          error: new Error(
            'Firebase is not configured. Contact your system administrator.',
          ),
        };
      }
      await firebaseSignUp(email, password, fullName, role as Profile['role']);
      return { error: null };
    } catch (error) {
      return { error: new Error((await import('@/lib/auth')).formatAuthError(error)) };
    }
  };

  const signOut = useCallback(async () => {
    const { signOut: firebaseSignOut } = await import('@/lib/auth');
    await firebaseSignOut();
    clearAuthSessionCookies();
    setUser(null);
    setProfile(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    const configuredMinutes = Number(process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MINUTES || 30);
    const timeoutMs = Math.max(5, Number.isFinite(configuredMinutes) ? configuredMinutes : 30) * 60_000;
    let idleTimer = window.setTimeout(() => void signOut(), timeoutMs);

    const resetIdleTimer = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => void signOut(), timeoutMs);
    };
    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown', 'keydown', 'scroll', 'touchstart',
    ];
    activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, resetIdleTimer, { passive: true }));
    window.addEventListener('focus', resetIdleTimer);

    return () => {
      window.clearTimeout(idleTimer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer));
      window.removeEventListener('focus', resetIdleTimer);
    };
  }, [signOut, user]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
