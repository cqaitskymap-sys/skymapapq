'use client';

import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export function StabilityAccessGuard({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  }

  if (!user) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorCard accessDenied title="Authentication Required" message="Sign in to access Stability Monitoring." />
      </div>
    );
  }

  if (!profile || !cpvPermissions.canViewStability(profile.role)) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorCard accessDenied title="Access Denied" message="You do not have permission to access Stability Monitoring." />
      </div>
    );
  }

  return <>{children}</>;
}
