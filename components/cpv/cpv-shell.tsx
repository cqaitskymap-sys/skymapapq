'use client';

import { AppShell } from '@/components/layout/AppShell';
import { ProtectedRoute } from '@/components/auth/protected-route';

export function CpvShell({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute module="cpv">
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}
