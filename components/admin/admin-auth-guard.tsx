'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { clearAuthSessionCookies } from '@/lib/auth-session-cookies';
import { Skeleton } from '@/components/ui/skeleton';
import { canAccessAdminRoute } from '@/lib/permissions';

interface AdminAuthGuardProps {
  children: React.ReactNode;
  requireSuperAdmin?: boolean;
  requireManageUsers?: boolean;
  requireManageMaster?: boolean;
}

export function AdminAuthGuard({
  children,
  requireSuperAdmin,
  requireManageUsers,
  requireManageMaster,
}: AdminAuthGuardProps) {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const perms = useAdminPermissions();
  const router = useRouter();
  const pathname = usePathname();
  const canAccessRoute = canAccessAdminRoute(perms.role, pathname);

  const BLOCKED_STATUSES = ['pending', 'disabled', 'locked', 'retired', 'rejected'];
  const isBlockedAccount = Boolean(
    profile && (
      !profile.is_active
      || BLOCKED_STATUSES.includes(profile.access_status || '')
    ),
  );

  useEffect(() => {
    if (authLoading || perms.loading) return;
    if (!user) {
      clearAuthSessionCookies();
      router.replace('/auth/login?redirect=/admin');
      return;
    }
    if (isBlockedAccount) {
      return;
    }
    if (!perms.canAccessAdmin) {
      router.replace('/launcher');
      return;
    }
    if (!canAccessRoute) {
      router.replace('/dashboard/admin');
      return;
    }
    if (requireSuperAdmin && !perms.canManageRoles) {
      router.replace('/dashboard/admin');
      return;
    }
    if (requireManageUsers && !perms.canManageUsers) {
      router.replace('/dashboard/admin');
      return;
    }
    if (requireManageMaster && !perms.canManageMasterData && perms.isReadOnly) {
      router.replace('/dashboard/admin');
    }
  }, [
    user,
    profile,
    authLoading,
    perms.loading,
    perms.canAccessAdmin,
    canAccessRoute,
    perms.canManageRoles,
    perms.canManageUsers,
    perms.canManageMasterData,
    perms.isReadOnly,
    router,
    requireSuperAdmin,
    requireManageUsers,
    requireManageMaster,
    isBlockedAccount,
  ]);

  if (authLoading || perms.loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!profile || isBlockedAccount) {
    return (
      <div className="mx-auto mt-12 max-w-lg space-y-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {!profile
            ? 'Your profile could not be loaded. Sign out and try again.'
            : 'Your account is pending approval, locked, or inactive.'}
        </p>
        <button
          type="button"
          className="text-sm text-blue-600 underline"
          onClick={async () => {
            await signOut();
            router.replace('/auth/login');
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  if (!perms.canAccessAdmin) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!canAccessRoute) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return <>{children}</>;
}
