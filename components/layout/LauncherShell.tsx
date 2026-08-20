'use client';

import { ReactNode } from 'react';
import { ProtectedRoute } from '@/components/auth/protected-route';
import { GuideCoach } from '@/components/user-guide/guide-coach';

export function LauncherShell({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      {children}
      <GuideCoach />
    </ProtectedRoute>
  );
}
