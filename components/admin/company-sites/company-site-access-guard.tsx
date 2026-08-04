'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canViewCompanySites } from '@/lib/permissions';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';

export function CompanySiteAccessGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: permsLoading, hasPermission } = useAdminPermissions();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/auth/login?redirect=/admin/company-site');
    }
  }, [authLoading, user, router]);

  if (authLoading || permsLoading) return <LoadingSkeleton rows={2} />;
  if (!user) return null;

  if (!canViewCompanySites(role) || !hasPermission('Admin', 'view')) {
    return (
      <ErrorCard
        accessDenied
        title="Access Denied"
        message="You do not have permission to access Company / Site Master."
      />
    );
  }

  return <>{children}</>;
}
