'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useLoading } from '@/contexts/loading-context';

const AUTH_ROUTES = ['/auth/login', '/auth/signup', '/auth/forgot-password', '/login'];

export function AuthLoadingBridge() {
  const pathname = usePathname();
  const { loading } = useAuth();
  const { startTask, endTask } = useLoading();
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  useEffect(() => {
    if (isAuthRoute) {
      endTask('firebase-auth');
      return;
    }
    if (loading) {
      startTask('firebase-auth', { message: 'Authenticating...', priority: 'critical' });
    } else {
      endTask('firebase-auth');
    }
    return () => endTask('firebase-auth');
  }, [loading, isAuthRoute, startTask, endTask]);

  return null;
}
