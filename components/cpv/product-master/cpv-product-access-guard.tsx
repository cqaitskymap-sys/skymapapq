'use client';

import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export function CpvProductAccessGuard({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <LoadingSkeleton rows={2} />
      </div>
    );
  }

  if (!user) {
    return (
      <ErrorCard
        accessDenied
        title="Authentication Required"
        message="Sign in to access CPV Product Master."
      />
    );
  }

  const role = profile?.role;
  if (!profile || !cpvPermissions.canViewCpvProducts(role)) {
    return (
      <ErrorCard
        accessDenied
        title="Access Denied"
        message="You do not have permission to access CPV Product Master."
      />
    );
  }

  return <>{children}</>;
}
