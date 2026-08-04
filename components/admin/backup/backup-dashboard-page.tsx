'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Download, Eye, Database, History, RotateCcw, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { BackupCharts } from './backup-charts';
import { BackupSettingsCard } from './backup-settings-card';
import { BackupStatusBadge } from './backup-status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canCreateBackup, canEditBackupSettings } from '@/lib/permissions';
import { BACKUP_TYPES, BACKUP_STATUSES } from '@/lib/admin/constants';
import type { BackupHistory } from '@/lib/admin/schemas';
import {
  fetchBackupHistory, fetchRestoreHistory, fetchBackupSettings,
  getBackupSummary, getBackupChartsData, exportBackupHistoryCsv,
  logBackupExport, seedDefaultBackupSettings,
} from '@/lib/admin/backup-service';

const PAGE_SIZE = 10;

export function BackupDashboardPage() {
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canCreate = canCreateBackup(role);
  const canEditSettings = canEditBackupSettings(role);

  const [backups, setBackups] = useState<BackupHistory[]>([]);
  const [restores, setRestores] = useState<Awaited<ReturnType<typeof fetchRestoreHistory>>>([]);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof fetchBackupSettings>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(0);

  const auditMeta = useMemo(() => ({
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  }), [profile?.email, profile?.full_name, user?.uid]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await seedDefaultBackupSettings(auditMeta);
      const [b, r, s] = await Promise.all([
        fetchBackupHistory(),
        fetchRestoreHistory(),
        fetchBackupSettings(),
      ]);
      setBackups(b);
      setRestores(r);
      setSettings(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [auditMeta]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return backups.filter((b) => {
      const matchSearch = !q ||
        b.backupNumber?.toLowerCase().includes(q) ||
        b.backupId?.toLowerCase().includes(q) ||
        b.backupType?.toLowerCase().includes(q);
      const matchType = typeFilter === 'all' || b.backupType === typeFilter;
      const matchStatus = statusFilter === 'all' || b.backupStatus === statusFilter;
      const matchStart = !startDate || b.backupDateTime >= startDate;
      const matchEnd = !endDate || b.backupDateTime <= `${endDate}T23:59:59`;
      return matchSearch && matchType && matchStatus && matchStart && matchEnd;
    });
  }, [backups, search, typeFilter, statusFilter, startDate, endDate]);

  const summary = getBackupSummary(backups, restores, settings);
  const charts = getBackupChartsData(backups, restores);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const handleExportExcel = async () => {
    const csv = exportBackupHistoryCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_log_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logBackupExport('excel', auditMeta, filtered.length);
    toast.success('Backup log exported');
  };

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup & Restore"
        description="Firestore database backup, restore points, and disaster recovery for GMP data integrity"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/backup/jobs"><Activity className="h-4 w-4 mr-1" />Jobs</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/backup/history"><History className="h-4 w-4 mr-1" />History</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/backup/restore"><RotateCcw className="h-4 w-4 mr-1" />Restore</Link>
            </Button>
            {canCreate && (
              <Button size="sm" className="bg-blue-600" asChild>
                <Link href="/admin/backup/create"><Plus className="h-4 w-4 mr-1" />Manual Backup</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-3">
        <KpiCard label="Total Backups" value={summary.totalBackups} icon={Database} />
        <KpiCard label="Successful" value={summary.successfulBackups} />
        <KpiCard label="Failed" value={summary.failedBackups} />
        <KpiCard label="Last Status" value={summary.lastBackupStatus} isStatus />
        <KpiCard label="Next Due" value={summary.nextBackupDue ? new Date(summary.nextBackupDue).toLocaleDateString() : '—'} />
        <KpiCard label="Restore Requests" value={summary.restoreRequests} />
        <KpiCard label="Completed Restores" value={summary.completedRestores} />
        <KpiCard label="Storage Used" value={summary.storageUsed} />
        <KpiCard label="Encrypted" value={summary.encryptedBackups} />
      </div>

      <BackupCharts
        successTrend={charts.successTrend}
        typeDistribution={charts.typeDistribution}
        restoreTrend={charts.restoreTrend}
        sizeTrend={charts.sizeTrend}
      />

      <BackupSettingsCard
        settings={settings}
        canEdit={canEditSettings}
        auditMeta={auditMeta}
        onSaved={load}
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search backup number, ID, type..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {BACKUP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {BACKUP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-[140px]" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-[140px]" />
            <Button variant="outline" size="sm" onClick={handleExportExcel}>
              <Download className="h-4 w-4 mr-1" />Export Log
            </Button>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Backup Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageData.length === 0 ? (
                  <TableRow><TableCell colSpan={8}><EmptyState title="No backups found" /></TableCell></TableRow>
                ) : pageData.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.backupNumber}</TableCell>
                    <TableCell>{new Date(b.backupDateTime).toLocaleString()}</TableCell>
                    <TableCell>{b.backupType}</TableCell>
                    <TableCell>{b.backupScope}</TableCell>
                    <TableCell><BackupStatusBadge status={b.backupStatus} /></TableCell>
                    <TableCell>{b.fileSize}</TableCell>
                    <TableCell>{b.recordsCount}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/backup/${b.id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {pageData.length === 0 ? <EmptyState title="No backups found" /> : pageData.map((b) => (
              <Card key={b.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{b.backupNumber}</p>
                      <p className="text-xs text-muted-foreground">{new Date(b.backupDateTime).toLocaleString()}</p>
                    </div>
                    <BackupStatusBadge status={b.backupStatus} />
                  </div>
                  <p className="text-sm">{b.backupType} · {b.backupScope}</p>
                  <p className="text-xs text-muted-foreground">{b.fileSize} · {b.recordsCount} records</p>
                  <Button variant="outline" size="sm" asChild><Link href={`/admin/backup/${b.id}`}>View</Link></Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-between items-center pt-2">
              <p className="text-sm text-muted-foreground">Page {page + 1} of {totalPages}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
