'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canViewWorkflows } from '@/lib/permissions';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';

export function WorkflowAccessGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: permsLoading, hasPermission } = useAdminPermissions();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth/login?redirect=/admin/workflows');
  }, [authLoading, user, router]);

  if (authLoading || permsLoading) return <LoadingSkeleton rows={2} />;
  if (!user) return null;

  if (!canViewWorkflows(role) || !hasPermission('Admin', 'view')) {
    return (
      <ErrorCard accessDenied title="Access Denied" message="You do not have permission to access Workflow Configuration." />
    );
  }

  return <>{children}</>;
}
