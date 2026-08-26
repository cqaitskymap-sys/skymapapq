'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canViewBatches, canViewProducts } from '@/lib/permissions';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';

type ManufacturingAccess = 'batches' | 'products' | 'any';

export function ManufacturingAccessGuard({
  children,
  require = 'any',
}: {
  children: React.ReactNode;
  require?: ManufacturingAccess;
}) {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: permsLoading } = useAdminPermissions();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/auth/login?redirect=${encodeURIComponent(pathname || '/manufacturing/dashboard')}`);
    }
  }, [authLoading, user, router, pathname]);

  if (authLoading || permsLoading) return <LoadingSkeleton rows={2} />;
  if (!user) return null;

  const allowed =
    require === 'batches'
      ? canViewBatches(role)
      : require === 'products'
        ? canViewProducts(role)
        : canViewBatches(role) || canViewProducts(role);

  if (!allowed) {
    return (
      <ErrorCard
        accessDenied
        title="Access Denied"
        message="You do not have permission to open Manufacturing."
      />
    );
  }

  return <>{children}</>;
}
