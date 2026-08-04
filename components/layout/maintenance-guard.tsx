'use client';

import { Wrench } from 'lucide-react';
import { useSystemSettings } from '@/contexts/system-settings-context';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

function isSuperAdmin(role?: string | null): boolean {
  return (role?.toLowerCase() || '') === 'super_admin';
}

function canAccessDuringMaintenance(role?: string | null): boolean {
  return ['super_admin', 'admin'].includes(role?.toLowerCase() || '');
}

export function MaintenanceGuard({ children }: { children: React.ReactNode }) {
  const { maintenanceActive, settings, loading, canBypassMaintenance } = useSystemSettings();
  const { profile, signOut } = useAuth();
  const router = useRouter();

  if (loading) return <>{children}</>;

  // Super admins always bypass so the system is never permanently locked out.
  const allowed =
    isSuperAdmin(profile?.role)
    || (
      Boolean(settings?.allowedAdminAccessDuringMaintenance)
      && (canBypassMaintenance || canAccessDuringMaintenance(profile?.role))
    );

  if (maintenanceActive && !allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md text-center space-y-4">
          <Wrench className="h-12 w-12 text-amber-600 mx-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Maintenance Mode</h1>
          <p className="text-muted-foreground">
            {settings?.maintenanceMessage || 'The system is temporarily unavailable for scheduled maintenance.'}
          </p>
          {settings?.scheduledMaintenanceEnd && (
            <p className="text-sm text-muted-foreground">
              Expected completion: {new Date(settings.scheduledMaintenanceEnd).toLocaleString()}
            </p>
          )}
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              router.replace('/auth/login');
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
