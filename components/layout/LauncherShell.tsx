'use client';

import { ReactNode } from 'react';
import { ProtectedRoute } from '@/components/auth/protected-route';

export function LauncherShell({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      {children}
    </ProtectedRoute>
  );
}
