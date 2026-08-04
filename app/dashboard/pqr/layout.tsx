'use client';

import { ProtectedRoute } from '@/components/auth/protected-route';

export default function PqrLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute module="pqr">
      <div className="space-y-4">
        {children}
      </div>
    </ProtectedRoute>
  );
}
