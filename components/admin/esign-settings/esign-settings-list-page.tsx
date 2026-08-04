'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Download, Eye, Pencil, UserCheck, UserX, Database, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ModuleBadge } from '@/components/admin/workflows/module-badge';
import { EsignActionBadge } from './action-type-badge';
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
import { canEditEsignSettings, canRecommendEsignChanges } from '@/lib/permissions';
import { ESIGN_SETTING_MODULES, RECORD_STATUSES } from '@/lib/admin/constants';
import type { EsignSettings } from '@/lib/admin/schemas';
import {
  fetchEsignSettings, getEsignSettingsSummary, setEsignSettingStatus,
  exportEsignSettingsCsv, logEsignSettingsExport, seedDefaultEsignSettings,
  softDeleteEsignSetting, subscribeToEsignSettings,
} from '@/lib/admin/esign-settings-service';
import { fetchEsignRecords, getEsignRecordsSummary } from '@/lib/admin/esign-service';

const PAGE_SIZE = 10;

export function EsignSettingsListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditEsignSettings(role);
  const canRecommend = canRecommendEsignChanges(role);

  const [settings, setSettings] = useState<EsignSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reauthFilter, setReauthFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<{ setting: EsignSettings; activate: boolean } | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [recordStats, setRecordStats] = useState({ totalRecords: 0, failedAttempts: 0 });
  const [deleteConfirm, setDeleteConfirm] = useState<EsignSettings | null>(null);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, records] = await Promise.all([fetchEsignSettings(), fetchEsignRecords()]);
      setSettings(list);
      setRecordStats(getEsignRecordsSummary(records));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToEsignSettings(
      (list) => {
        setSettings(list);
        setError(null);
        setLoading(false);
      },
      () => { void load(); },
    );
    void fetchEsignRecords().then((records) => setRecordStats(getEsignRecordsSummary(records))).catch(() => undefined);
    return () => unsub();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return settings.filter((s) => {
      const matchSearch = !q ||
        s.settingCode?.toLowerCase().includes(q) ||
        s.moduleName?.toLowerCase().includes(q) ||
        s.actionType?.toLowerCase().includes(q) ||
        s.signatureMeaning?.toLowerCase().includes(q);
      const matchModule = moduleFilter === 'all' || s.moduleName === moduleFilter;
      const matchStatus = statusFilter === 'all' || s.status === statusFilter;
      const matchReauth = reauthFilter === 'all' ||
        (reauthFilter === 'yes' && s.requirePasswordReAuthentication) ||
        (reauthFilter === 'no' && !s.requirePasswordReAuthentication);
      return matchSearch && matchModule && matchStatus && matchReauth;
    });
  }, [settings, search, moduleFilter, statusFilter, reauthFilter]);

  const stats = getEsignSettingsSummary(settings);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const handleExport = async () => {
    const csv = exportEsignSettingsCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `esign-settings-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logEsignSettingsExport(auditMeta, filtered.length);
    toast.success('E-signature settings exported');
  };

  const handleSeed = async () => {
    setSeeding(true);
    const result = await seedDefaultEsignSettings(auditMeta);
    setSeeding(false);
    toast.success(`Created ${result.created}, skipped ${result.skipped}`);
    load();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const status = confirm.activate ? 'Active' : 'Inactive';
    const result = await setEsignSettingStatus(confirm.setting.id!, confirm.setting, status, auditMeta);
    if (result.success) {
      toast.success(`Setting ${status === 'Active' ? 'activated' : 'deactivated'}`);
      load();
    } else toast.error(result.error || 'Action failed');
    setConfirm(null);
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id) return;
    const result = await softDeleteEsignSetting(deleteConfirm.id, auditMeta, 'Soft-deleted via Admin UI');
    if (result.success) {
      toast.success('E-sign setting deleted');
      load();
    } else {
      toast.error(result.error || 'Delete failed');
    }
    setDeleteConfirm(null);
  };

  if (loading) return <div><PageHeader title="E-Signature Settings" basePath="/admin" /><LoadingSkeleton rows={2} /></div>;
  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="E-Signature Settings"
        description="21 CFR Part 11 compliant electronic signature configuration"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/esign-settings/history">Signature History</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail">Audit Trail</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" size="sm" disabled={seeding} onClick={handleSeed}>
                  <Database className="h-4 w-4 mr-1" />{seeding ? 'Seeding...' : 'Seed Defaults'}
                </Button>
                <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                  <Link href="/admin/esign-settings/create">
                    <Plus className="h-4 w-4 mr-1" />Create Setting
                  </Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      {canRecommend && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          QA Head: review e-signature rules and recommend changes to Admin.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <KpiCard label="Total Settings" value={stats.total} />
        <KpiCard label="Active" value={stats.active} />
        <KpiCard label="Inactive" value={stats.inactive} />
        <KpiCard label="Password Required" value={stats.passwordRequired} />
        <KpiCard label="Comment Required" value={stats.commentRequired} />
        <KpiCard label="E-Sign Records" value={recordStats.totalRecords} />
        <KpiCard label="Failed Attempts" value={recordStats.failedAttempts} />
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search module, action, meaning..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
            </div>
            <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Module" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                {ESIGN_SETTING_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={reauthFilter} onValueChange={(v) => { setReauthFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Re-auth" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Re-auth</SelectItem>
                <SelectItem value="yes">Password Required</SelectItem>
                <SelectItem value="no">No Password</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {RECORD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden md:block overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Code</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Meaning</TableHead>
                  <TableHead>Password</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={7}><EmptyState title="No e-signature settings found" /></TableCell></TableRow>
                ) : (
                  paginated.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.settingCode}</TableCell>
                      <TableCell><ModuleBadge module={row.moduleName} /></TableCell>
                      <TableCell><EsignActionBadge action={row.actionType} /></TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{row.signatureMeaning}</TableCell>
                      <TableCell>{row.requirePasswordReAuthentication ? 'Yes' : 'No'}</TableCell>
                      <TableCell><StatusBadge status={row.status} /></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button asChild variant="ghost" size="icon">
                            <Link href={`/admin/esign-settings/${row.id}`}><Eye className="h-4 w-4" /></Link>
                          </Button>
                          {canEdit && (
                            <>
                              <Button asChild variant="ghost" size="icon">
                                <Link href={`/admin/esign-settings/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                              </Button>
                              {row.status === 'Active'
                                ? (
                                  <Button variant="ghost" size="icon" onClick={() => setConfirm({ setting: row, activate: false })}>
                                    <UserX className="h-4 w-4 text-amber-600" />
                                  </Button>
                                )
                                : (
                                  <Button variant="ghost" size="icon" onClick={() => setConfirm({ setting: row, activate: true })}>
                                    <UserCheck className="h-4 w-4 text-green-600" />
                                  </Button>
                                )}
                              {canDelete && (
                                <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(row)}>
                                  <Trash2 className="h-4 w-4 text-red-600" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {paginated.map((row) => (
              <Card key={row.id} className="border">
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between">
                    <p className="font-mono text-sm font-semibold">{row.settingCode}</p>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ModuleBadge module={row.moduleName} />
                    <EsignActionBadge action={row.actionType} />
                  </div>
                  <p className="text-xs text-muted-foreground">{row.signatureMeaning}</p>
                  <div className="flex gap-2 pt-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/admin/esign-settings/${row.id}`}>View</Link>
                    </Button>
                    {canEdit && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/esign-settings/${row.id}/edit`}>Edit</Link>
                      </Button>
                    )}
                    {canDelete && <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(row)}>Delete</Button>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{filtered.length} settings</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>Page {currentPage + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!confirm} onOpenChange={() => setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.activate ? 'Activate Setting' : 'Deactivate Setting'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.activate
                ? `Activate "${confirm?.setting.settingCode}"?`
                : `Deactivate "${confirm?.setting.settingCode}"?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm} className="bg-indigo-600">Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete E-Sign Setting</AlertDialogTitle>
            <AlertDialogDescription>
              {`Delete "${deleteConfirm?.settingCode}"? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
