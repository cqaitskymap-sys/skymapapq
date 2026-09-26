'use client';

import { useAuth } from '@/contexts/auth-context';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export function CpvModuleAccessGuard({
  children,
  canView,
  moduleLabel,
}: {
  children: React.ReactNode;
  canView: (role?: string) => boolean;
  moduleLabel: string;
}) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <LoadingSkeleton rows={1} />;
  }

  if (!user) {
    return (
      <ErrorCard
        accessDenied
        title="Authentication Required"
        message={`Sign in to access ${moduleLabel}.`}
      />
    );
  }

  if (!profile || !canView(profile.role)) {
    return (
      <ErrorCard
        accessDenied
        title="Access Denied"
        message={`You do not have permission to access ${moduleLabel}.`}
      />
    );
  }

  return <>{children}</>;
}
