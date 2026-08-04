'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, Download, Eye, Pencil, Power, PowerOff, Database, Trash2, History, Settings,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditModuleConfiguration } from '@/lib/permissions';
import {
  MODULE_CONFIG_CATEGORIES, MODULE_FEATURE_STATUSES, SYSTEM_ENVIRONMENTS,
} from '@/lib/admin/constants';
import type { ModuleConfig } from '@/lib/admin/schemas';
import {
  subscribeToModuleConfigurations, getModuleConfigSummary,
  setModuleEnabled, softDeleteModuleConfiguration,
  exportModuleConfigurationsCsv, logModuleConfigurationExport, seedDefaultModuleConfigurations,
} from '@/lib/admin/module-configuration-service';

const PAGE_SIZE = 12;

export function ModuleConfigurationListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditModuleConfiguration(role);

  const [modules, setModules] = useState<ModuleConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [enabledFilter, setEnabledFilter] = useState('all');
  const [featureFilter, setFeatureFilter] = useState('all');
  const [envFilter, setEnvFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [toggleConfirm, setToggleConfirm] = useState<{ module: ModuleConfig; enable: boolean } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ModuleConfig | null>(null);
  const [seeding, setSeeding] = useState(false);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToModuleConfigurations(
      (rows) => { setModules(rows); setError(null); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return modules.filter((m) => {
      const matchSearch = !q
        || m.moduleCode?.toLowerCase().includes(q)
        || m.moduleName?.toLowerCase().includes(q)
        || m.navigationPath?.toLowerCase().includes(q);
      const matchCategory = categoryFilter === 'all' || m.moduleCategory === categoryFilter;
      const matchEnabled = enabledFilter === 'all'
        || (enabledFilter === 'enabled' && m.isEnabled)
        || (enabledFilter === 'disabled' && !m.isEnabled);
      const matchFeature = featureFilter === 'all' || m.featureStatus === featureFilter;
      const matchEnv = envFilter === 'all' || m.environment === envFilter;
      return matchSearch && matchCategory && matchEnabled && matchFeature && matchEnv;
    });
  }, [modules, search, categoryFilter, enabledFilter, featureFilter, envFilter]);

  const stats = getModuleConfigSummary(modules);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const handleExport = async () => {
    const csv = exportModuleConfigurationsCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `module-configuration-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logModuleConfigurationExport(auditMeta, filtered.length);
    toast.success('Module configuration exported');
  };

  const handleSeed = async () => {
    setSeeding(true);
    const result = await seedDefaultModuleConfigurations(auditMeta);
    setSeeding(false);
    toast.success(`Created ${result.created}, skipped ${result.skipped}`);
  };

  const runToggle = async () => {
    if (!toggleConfirm?.module.id) return;
    const result = await setModuleEnabled(
      toggleConfirm.module.id,
      toggleConfirm.enable,
      auditMeta,
      `${toggleConfirm.enable ? 'Enabled' : 'Disabled'} via Admin UI`,
    );
    if (result.success) toast.success(`Module ${toggleConfirm.enable ? 'enabled' : 'disabled'}`);
    else toast.error(result.error || 'Action failed');
    setToggleConfirm(null);
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id) return;
    const result = await softDeleteModuleConfiguration(deleteConfirm.id, auditMeta, 'Uninstalled via Admin UI');
    if (result.success) toast.success('Module uninstalled (soft)');
    else toast.error(result.error || 'Uninstall failed');
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Module Configuration" basePath="/admin" />
        <LoadingSkeleton rows={2} />
      </div>
    );
  }
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Module Configuration"
        description="Enable modules, manage dependencies, feature flags, and licenses"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/system-settings"><Settings className="h-4 w-4 mr-1" />System Settings</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail?module=Module%20Configuration">Audit Trail</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" size="sm" disabled={seeding} onClick={handleSeed}>
                  <Database className="h-4 w-4 mr-1" />{seeding ? 'Seeding…' : 'Seed Defaults'}
                </Button>
                <Button asChild size="sm" className="bg-sky-600 hover:bg-sky-700">
                  <Link href="/admin/module-configuration/create"><Plus className="h-4 w-4 mr-1" />Add Module</Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="Enabled" value={stats.enabled} />
        <KpiCard label="Disabled" value={stats.disabled} />
        <KpiCard label="Critical / System" value={stats.critical} />
        <KpiCard label="Beta / Exp." value={stats.beta} />
        <KpiCard label="Licensed" value={stats.licensed} />
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search code, name, path..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
            <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {MODULE_CONFIG_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={enabledFilter} onValueChange={(v) => { setEnabledFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[130px]"><SelectValue placeholder="Enabled" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={featureFilter} onValueChange={(v) => { setFeatureFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Feature" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Features</SelectItem>
                {MODULE_FEATURE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={envFilter} onValueChange={(v) => { setEnvFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Environment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Envs</SelectItem>
                {SYSTEM_ENVIRONMENTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden md:block overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Deps</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={8}><EmptyState title="No modules found — seed defaults to start" /></TableCell></TableRow>
                ) : paginated.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.moduleCode}</TableCell>
                    <TableCell className="text-sm">
                      {row.displayName || row.moduleName}
                      {(row.isCritical || row.isSystemModule) && (
                        <span className="ml-2 text-[10px] text-amber-700 dark:text-amber-400">SYSTEM</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{row.moduleCategory}</TableCell>
                    <TableCell className="font-mono text-[11px] max-w-[160px] truncate">{row.navigationPath || '—'}</TableCell>
                    <TableCell className="text-[11px] max-w-[120px] truncate">{(row.dependencies || []).join(', ') || '—'}</TableCell>
                    <TableCell><StatusBadge status={row.isEnabled ? 'Active' : 'Inactive'} /></TableCell>
                    <TableCell className="text-xs">{row.licenseStatus}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon"><Link href={`/admin/module-configuration/${row.id}`}><Eye className="h-4 w-4" /></Link></Button>
                        <Button asChild variant="ghost" size="icon"><Link href={`/admin/module-configuration/${row.id}/versions`}><History className="h-4 w-4" /></Link></Button>
                        {canEdit && (
                          <>
                            <Button asChild variant="ghost" size="icon"><Link href={`/admin/module-configuration/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link></Button>
                            {row.isEnabled
                              ? <Button variant="ghost" size="icon" onClick={() => setToggleConfirm({ module: row, enable: false })}><PowerOff className="h-4 w-4 text-amber-600" /></Button>
                              : <Button variant="ghost" size="icon" onClick={() => setToggleConfirm({ module: row, enable: true })}><Power className="h-4 w-4 text-green-600" /></Button>}
                            {canDelete && !row.isSystemModule && !row.isCritical && (
                              <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(row)}>
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {paginated.map((row) => (
              <Card key={row.id} className="border">
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between">
                    <p className="font-mono text-sm font-semibold">{row.moduleCode}</p>
                    <StatusBadge status={row.isEnabled ? 'Active' : 'Inactive'} />
                  </div>
                  <p className="text-sm">{row.moduleName}</p>
                  <p className="text-xs text-muted-foreground">{row.moduleCategory} · {row.navigationPath || 'no path'}</p>
                  <div className="flex gap-2 pt-2">
                    <Button asChild size="sm" variant="outline"><Link href={`/admin/module-configuration/${row.id}`}>View</Link></Button>
                    {canEdit && <Button asChild size="sm" variant="outline"><Link href={`/admin/module-configuration/${row.id}/edit`}>Edit</Link></Button>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{filtered.length} modules</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>Page {currentPage + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!toggleConfirm} onOpenChange={() => setToggleConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{toggleConfirm?.enable ? 'Enable Module' : 'Disable Module'}</AlertDialogTitle>
            <AlertDialogDescription>
              {toggleConfirm?.enable
                ? `Enable "${toggleConfirm?.module.moduleCode}"? Dependencies will be validated.`
                : `Disable "${toggleConfirm?.module.moduleCode}"? Dependent modules will block this if active.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runToggle} className="bg-sky-600">Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall Module</AlertDialogTitle>
            <AlertDialogDescription>
              Soft-uninstall &quot;{deleteConfirm?.moduleCode}&quot;? Version history is retained. System modules cannot be uninstalled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete} className="bg-red-600 hover:bg-red-700">Uninstall</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
