'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Power, PowerOff, History, ToggleLeft } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditModuleConfiguration } from '@/lib/permissions';
import type { ModuleConfig } from '@/lib/admin/schemas';
import { setModuleEnabled, setModuleFeatureFlag } from '@/lib/admin/module-configuration-service';

interface ModuleConfigurationDetailViewProps {
  module: ModuleConfig;
  onRefresh: () => void;
}

export function ModuleConfigurationDetailView({ module, onRefresh }: ModuleConfigurationDetailViewProps) {
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditModuleConfiguration(role);
  const [loading, setLoading] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  const toggleEnabled = async () => {
    setLoading(true);
    const enable = !module.isEnabled;
    const result = await setModuleEnabled(
      module.id!,
      enable,
      auditMeta,
      enable ? 'Enabled via detail' : 'Disabled via detail',
    );
    setLoading(false);
    if (result.success) {
      toast.success(enable ? 'Module enabled' : 'Module disabled');
      onRefresh();
    } else toast.error(result.error || 'Action failed');
    setConfirmDisable(false);
  };

  const toggleFlag = async (flagKey: string, enabled: boolean) => {
    setLoading(true);
    const result = await setModuleFeatureFlag(module.id!, flagKey, enabled, auditMeta);
    setLoading(false);
    if (result.success) {
      toast.success(`Feature ${flagKey} ${enabled ? 'enabled' : 'disabled'}`);
      onRefresh();
    } else toast.error(result.error || 'Feature update failed');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={module.moduleCode}
        description={`${module.displayName || module.moduleName} · ${module.moduleCategory} · v${module.version || '1.0.0'}`}
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/module-configuration/${module.id}/versions`}>
                <History className="h-4 w-4 mr-1" />Versions
              </Link>
            </Button>
            {canEdit && (
              <>
                {module.isEnabled ? (
                  <Button variant="outline" size="sm" disabled={loading} onClick={() => setConfirmDisable(true)}>
                    <PowerOff className="h-4 w-4 mr-1" />Disable
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={loading} onClick={toggleEnabled}>
                    <Power className="h-4 w-4 mr-1" />Enable
                  </Button>
                )}
                <Button size="sm" asChild className="bg-sky-600 hover:bg-sky-700">
                  <Link href={`/admin/module-configuration/${module.id}/edit`}>
                    <Pencil className="h-4 w-4 mr-1" />Edit
                  </Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={module.isEnabled ? 'Active' : 'Inactive'} />
        <StatusBadge status={module.licenseStatus || 'Licensed'} />
        <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">{module.featureStatus}</span>
        <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">{module.environment}</span>
        <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">{module.visibility}</span>
        {(module.isCritical || module.isSystemModule) && (
          <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40">Critical / System</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">Config ID</span><span className="font-mono text-xs">{module.moduleConfigId}</span>
            <span className="text-muted-foreground">Path</span><span className="font-mono text-xs">{module.navigationPath || '—'}</span>
            <span className="text-muted-foreground">Menu Group</span><span>{module.menuGroup || '—'}</span>
            <span className="text-muted-foreground">Icon</span><span>{module.icon || '—'}</span>
            <span className="text-muted-foreground">Order</span><span>{module.displayOrder}</span>
            <span className="text-muted-foreground">Required Role</span><span>{module.requiredRole || '—'}</span>
            <span className="text-muted-foreground">Company / Site</span>
            <span>{module.company || '—'} / {module.site || '—'}</span>
            <span className="text-muted-foreground">Build</span><span>{module.buildNumber || '—'}</span>
            <span className="text-muted-foreground">Installed</span><span>{module.isInstalled ? 'Yes' : 'No'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Dependencies</CardTitle></CardHeader>
          <CardContent>
            {(module.dependencies || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No dependencies</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(module.dependencies || []).map((d) => (
                  <li key={d} className="font-mono text-xs border rounded px-2 py-1">{d}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground mt-3">
              Disabling this module is blocked while other enabled modules list it as a dependency.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ToggleLeft className="h-4 w-4" />Feature Flags
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(module.featureFlags || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No feature flags configured for this module.</p>
          ) : (module.featureFlags || []).map((flag) => (
            <div key={flag.key} className="flex items-center justify-between border rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-medium">{flag.label || flag.key}</p>
                <p className="text-[11px] text-muted-foreground font-mono">
                  {flag.key} · {flag.rollout || 'Off'}
                  {flag.roles?.length ? ` · roles: ${flag.roles.join(',')}` : ''}
                </p>
              </div>
              <Switch
                checked={flag.enabled === true}
                disabled={!canEdit || loading}
                onCheckedChange={(checked) => toggleFlag(flag.key, checked)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Configuration JSON</CardTitle></CardHeader>
        <CardContent>
          <pre className="text-xs font-mono whitespace-pre-wrap border rounded p-3 bg-slate-50 dark:bg-slate-900/40 max-h-64 overflow-auto">
            {module.configurationJson || '{}'}
          </pre>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable module?</AlertDialogTitle>
            <AlertDialogDescription>
              Dependent active modules will prevent disable. Critical/system modules cannot be disabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={toggleEnabled}>Disable</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
