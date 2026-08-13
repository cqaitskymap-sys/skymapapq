'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { canAccessModule } from '@/lib/permissions';
import { clearAuthSessionCookies } from '@/lib/auth-session-cookies';
import { resolveModuleFromPath } from '@/lib/nav-permissions';
import { PremiumFullScreenLoader } from '@/components/loading';
import { ShieldX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface ProtectedRouteProps {
  children: ReactNode;
  /** Override auto-detected module from pathname */
  module?: Parameters<typeof canAccessModule>[1];
  requireEdit?: boolean;
}

export function ProtectedRoute({ children, module, requireEdit = false }: ProtectedRouteProps) {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      clearAuthSessionCookies();
      router.replace(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [user, loading, router, pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <PremiumFullScreenLoader message="Authenticating..." compact />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <PremiumFullScreenLoader message="Redirecting to login..." compact />
      </div>
    );
  }

  if (!profile) {
    return (
      <Card className="mx-auto mt-12 max-w-lg border-amber-200">
        <CardContent className="space-y-4 p-8 text-center">
          <ShieldX className="mx-auto h-12 w-12 text-amber-500" />
          <h2 className="text-xl font-bold">Profile unavailable</h2>
          <p className="text-sm text-muted-foreground">
            Your account signed in, but the user profile could not be loaded. Sign out and try again, or contact an administrator.
          </p>
          <Button variant="outline" onClick={async () => {
            await signOut();
            router.replace('/auth/login');
          }}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!profile.is_active || ['pending', 'disabled', 'locked', 'retired', 'rejected'].includes(profile.access_status || '')) {
    return (
      <Card className="mx-auto mt-12 max-w-lg border-amber-200">
        <CardContent className="space-y-4 p-8 text-center">
          <ShieldX className="mx-auto h-12 w-12 text-amber-500" />
          <h2 className="text-xl font-bold">Account approval pending</h2>
          <p className="text-sm text-muted-foreground">
            An administrator must verify your identity, department, and role before access is enabled.
          </p>
          <Button variant="outline" onClick={async () => {
            await signOut();
            router.replace('/auth/login');
          }}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    );
  }

  const resolvedModule = module ?? resolveModuleFromPath(pathname);
  if (resolvedModule && !canAccessModule(profile.role, resolvedModule)) {
    return (
      <Card className="mx-auto mt-12 max-w-lg border-red-200">
        <CardContent className="space-y-4 p-8 text-center">
          <ShieldX className="mx-auto h-12 w-12 text-red-500" />
          <h2 className="text-xl font-bold">Access Denied</h2>
          <p className="text-sm text-muted-foreground">
            Your role does not have permission to access this module.
          </p>
          <Button asChild variant="outline">
            <Link href="/launcher">Return to Launcher</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (requireEdit && ['viewer', 'auditor'].includes(profile.role)) {
    return (
      <Card className="mx-auto mt-12 max-w-lg border-amber-200">
        <CardContent className="space-y-4 p-8 text-center">
          <ShieldX className="mx-auto h-12 w-12 text-amber-500" />
          <h2 className="text-xl font-bold">Read-Only Access</h2>
          <p className="text-sm text-muted-foreground">You can view records but cannot modify them.</p>
          <Button asChild variant="outline"><Link href="/launcher">Return to Launcher</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
