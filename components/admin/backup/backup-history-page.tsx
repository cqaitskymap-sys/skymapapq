'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Download, Printer, Search, ChevronDown, ChevronUp, Eye, Archive,
  FileSearch, ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { BackupStatusBadge } from './backup-status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canViewBackup, canCreateBackup, canEditBackupSettings } from '@/lib/permissions';
import {
  BACKUP_TYPES, BACKUP_STATUSES, RESTORE_TYPES, RESTORE_STATUSES,
  BACKUP_INTEGRITY_STATUSES, BACKUP_STORAGE_PROVIDERS,
} from '@/lib/admin/constants';
import type { BackupHistory, RestoreHistory } from '@/lib/admin/schemas';
import {
  subscribeToBackupHistory, subscribeToRestoreHistory,
  applyBackupHistoryFilters, applyRestoreHistoryFilters,
  getHistoryDashboardSummary,
  exportBackupHistoryCsv, exportRestoreHistoryCsv,
  buildBackupHistoryPdfHtml, buildRestoreHistoryPdfHtml,
  buildFailedBackupReportHtml, buildIntegrityReportHtml,
  buildRetentionReportHtml, buildComplianceHistoryReportHtml,
  archiveBackupHistoryRecord, archiveRestoreHistoryRecord,
  logBackupExport, verifyBackup,
  type BackupHistoryListTab,
} from '@/lib/admin/backup-service';

const PAGE_SIZE = 15;

const LIST_TABS: { value: BackupHistoryListTab; label: string }[] = [
  { value: 'all', label: 'Overview' },
  { value: 'backups', label: 'Backups' },
  { value: 'restores', label: 'Restores' },
  { value: 'failed', label: 'Failed' },
  { value: 'integrity', label: 'Integrity' },
  { value: 'encrypted', label: 'Encrypted' },
  { value: 'expired', label: 'Expired' },
  { value: 'archived', label: 'Archived' },
];

function openHtmlReport(html: string) {
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

function downloadCsv(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function BackupHistoryPage() {
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canArchive = canEditBackupSettings(role) || canCreateBackup(role);
  const canVerify = canViewBackup(role);

  const [backups, setBackups] = useState<BackupHistory[]>([]);
  const [restores, setRestores] = useState<RestoreHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BackupHistoryListTab>('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState('');
  const [backupType, setBackupType] = useState('all');
  const [restoreType, setRestoreType] = useState('all');
  const [status, setStatus] = useState('all');
  const [integrityStatus, setIntegrityStatus] = useState('all');
  const [encryptionStatus, setEncryptionStatus] = useState('all');
  const [storageProvider, setStorageProvider] = useState('all');
  const [createdBy, setCreatedBy] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [archiveTarget, setArchiveTarget] = useState<{ kind: 'backup' | 'restore'; row: BackupHistory | RestoreHistory } | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };
  const generatedBy = auditMeta.userName;

  useEffect(() => {
    setLoading(true);
    const includeArchived = activeTab === 'archived';
    const unsubB = subscribeToBackupHistory(
      (list) => { setBackups(list); setError(null); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
      includeArchived,
    );
    const unsubR = subscribeToRestoreHistory(
      (list) => { setRestores(list); },
      undefined,
      includeArchived,
    );
    return () => { unsubB(); unsubR(); };
  }, [activeTab]);

  const filters = useMemo(() => ({
    search, backupType, restoreType, status, integrityStatus,
    encryptionStatus, storageProvider, createdBy, startDate, endDate,
  }), [search, backupType, restoreType, status, integrityStatus, encryptionStatus, storageProvider, createdBy, startDate, endDate]);

  const filteredBackups = useMemo(() => {
    let rows = applyBackupHistoryFilters(backups, filters);
    const now = Date.now();
    if (activeTab === 'failed') rows = rows.filter((b) => b.backupStatus === 'Failed');
    if (activeTab === 'integrity') {
      rows = rows.filter((b) => b.integrityStatus === 'Failed' || b.integrityStatus === 'Verified' || b.backupStatus === 'Verified');
    }
    if (activeTab === 'encrypted') rows = rows.filter((b) => b.encryptionStatus === 'Encrypted');
    if (activeTab === 'expired') {
      rows = rows.filter((b) => b.expirationDate && new Date(b.expirationDate).getTime() < now);
    }
    if (activeTab === 'archived') rows = rows.filter((b) => b.isArchived);
    return rows;
  }, [backups, filters, activeTab]);

  const filteredRestores = useMemo(() => {
    let rows = applyRestoreHistoryFilters(restores, filters);
    if (activeTab === 'failed') rows = rows.filter((r) => r.restoreStatus === 'Failed');
    if (activeTab === 'archived') rows = rows.filter((r) => r.isArchived);
    return rows;
  }, [restores, filters, activeTab]);

  const summary = useMemo(
    () => getHistoryDashboardSummary(backups, restores),
    [backups, restores],
  );

  const showBackups = activeTab === 'all' || activeTab === 'backups' || activeTab === 'failed'
    || activeTab === 'integrity' || activeTab === 'encrypted' || activeTab === 'expired' || activeTab === 'archived';
  const showRestores = activeTab === 'all' || activeTab === 'restores' || activeTab === 'failed' || activeTab === 'archived';

  const backupPages = Math.max(1, Math.ceil(filteredBackups.length / PAGE_SIZE));
  const restorePages = Math.max(1, Math.ceil(filteredRestores.length / PAGE_SIZE));
  const currentPage = Math.min(page, Math.max(backupPages, restorePages) - 1);
  const pagedBackups = filteredBackups.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const pagedRestores = filteredRestores.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const runArchive = async () => {
    if (!archiveTarget || archiveReason.trim().length < 5) {
      toast.error('Archive reason required (min 5 characters)');
      return;
    }
    setArchiveBusy(true);
    const result = archiveTarget.kind === 'backup'
      ? await archiveBackupHistoryRecord(archiveTarget.row.id!, archiveReason)
      : await archiveRestoreHistoryRecord(archiveTarget.row.id!, archiveReason);
    setArchiveBusy(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('History archived (immutable copy retained)');
      setArchiveTarget(null);
      setArchiveReason('');
    }
  };

  const handleVerify = async (b: BackupHistory) => {
    setVerifyBusy(b.id || b.backupId);
    const result = await verifyBackup(b, auditMeta);
    setVerifyBusy(null);
    if (result.verified) toast.success(`Verified ${b.backupNumber}`);
    else toast.error(result.error || 'Verification failed');
  };

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup & Restore History"
        description="Immutable chronological log of backup and restore operations for disaster recovery and Part 11 traceability"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail?module=Backup"><FileSearch className="h-4 w-4 mr-1" />Audit Trail</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/backup"><ArrowLeft className="h-4 w-4 mr-1" />Backup Dashboard</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Backups" value={summary.totalBackups} />
        <KpiCard label="Restores" value={summary.totalRestores} />
        <KpiCard label="Failed Backups" value={summary.failedBackups} />
        <KpiCard label="Failed Restores" value={summary.failedRestores} />
        <KpiCard label="Encrypted" value={summary.encrypted} />
        <KpiCard label="Storage" value={summary.storageUsed} />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as BackupHistoryListTab); setPage(0); }}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {LIST_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search backup/restore ID, checksum, reason, actor..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
              Advanced Filters
            </Button>
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Backup Type</Label>
                <Select value={backupType} onValueChange={(v) => { setBackupType(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {BACKUP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Restore Type</Label>
                <Select value={restoreType} onValueChange={(v) => { setRestoreType(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {RESTORE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {[...BACKUP_STATUSES, ...RESTORE_STATUSES].filter((v, i, a) => a.indexOf(v) === i).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Integrity</Label>
                <Select value={integrityStatus} onValueChange={(v) => { setIntegrityStatus(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {BACKUP_INTEGRITY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Encryption</Label>
                <Select value={encryptionStatus} onValueChange={(v) => { setEncryptionStatus(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="Encrypted">Encrypted</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Storage Provider</Label>
                <Select value={storageProvider} onValueChange={(v) => { setStorageProvider(v); setPage(0); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {BACKUP_STORAGE_PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Created By</Label>
                <Input value={createdBy} onChange={(e) => { setCreatedBy(e.target.value); setPage(0); }} placeholder="User id / name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date From</Label>
                <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(0); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date To</Label>
                <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(0); }} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={async () => {
              openHtmlReport(buildBackupHistoryPdfHtml(filteredBackups, generatedBy));
              await logBackupExport('backup history pdf', auditMeta, filteredBackups.length);
              toast.success('Backup history PDF opened');
            }}><Printer className="h-4 w-4 mr-1" />Backup PDF</Button>
            <Button variant="outline" size="sm" onClick={async () => {
              downloadCsv(exportBackupHistoryCsv(filteredBackups), `backup_history_${Date.now()}.csv`);
              await logBackupExport('backup history excel', auditMeta, filteredBackups.length);
              toast.success('Backup CSV exported');
            }}><Download className="h-4 w-4 mr-1" />Backup Excel</Button>
            <Button variant="outline" size="sm" onClick={async () => {
              openHtmlReport(buildRestoreHistoryPdfHtml(filteredRestores, generatedBy));
              await logBackupExport('restore history pdf', auditMeta, filteredRestores.length);
              toast.success('Restore history PDF opened');
            }}><Printer className="h-4 w-4 mr-1" />Restore PDF</Button>
            <Button variant="outline" size="sm" onClick={async () => {
              downloadCsv(exportRestoreHistoryCsv(filteredRestores), `restore_history_${Date.now()}.csv`);
              await logBackupExport('restore history excel', auditMeta, filteredRestores.length);
              toast.success('Restore CSV exported');
            }}><Download className="h-4 w-4 mr-1" />Restore Excel</Button>
            <Button variant="outline" size="sm" onClick={() => {
              openHtmlReport(buildFailedBackupReportHtml(backups, generatedBy));
              toast.success('Failed backup report opened');
            }}>Failed Report</Button>
            <Button variant="outline" size="sm" onClick={() => {
              openHtmlReport(buildIntegrityReportHtml(backups, generatedBy));
              toast.success('Integrity report opened');
            }}>Integrity Report</Button>
            <Button variant="outline" size="sm" onClick={() => {
              openHtmlReport(buildRetentionReportHtml(backups, generatedBy));
              toast.success('Retention report opened');
            }}>Retention Report</Button>
            <Button variant="outline" size="sm" onClick={async () => {
              openHtmlReport(buildComplianceHistoryReportHtml(filteredBackups, filteredRestores, generatedBy));
              await logBackupExport('compliance history report', auditMeta);
              toast.success('Compliance / DR report opened');
            }}>Compliance Report</Button>
          </div>
        </CardContent>
      </Card>

      {showBackups && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <div className="px-4 py-3 border-b text-sm font-medium">
              Backup History ({filteredBackups.length})
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Number / ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Integrity</TableHead>
                  <TableHead>Encryption</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedBackups.length === 0 ? (
                  <TableRow><TableCell colSpan={9}><EmptyState title="No backup history" /></TableCell></TableRow>
                ) : pagedBackups.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/admin/backup/${b.id}`} className="font-medium hover:underline">{b.backupNumber}</Link>
                      <div className="font-mono text-[10px] text-muted-foreground">{b.backupId}</div>
                    </TableCell>
                    <TableCell className="text-xs">{b.backupType}</TableCell>
                    <TableCell className="text-xs">{b.backupScope}</TableCell>
                    <TableCell><BackupStatusBadge status={b.backupStatus} /></TableCell>
                    <TableCell className="text-xs">{b.integrityStatus || '—'}</TableCell>
                    <TableCell className="text-xs">{b.encryptionStatus || '—'}</TableCell>
                    <TableCell className="text-xs">{b.fileSize || '—'}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(b.backupDateTime).slice(0, 19)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/admin/backup/${b.id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                      {canVerify && b.checksum && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={verifyBusy === (b.id || b.backupId)}
                          onClick={() => handleVerify(b)}
                          title="Verify integrity"
                        >
                          <ShieldCheck className="h-4 w-4" />
                        </Button>
                      )}
                      {canArchive && !b.isArchived && !b.isProtected && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setArchiveTarget({ kind: 'backup', row: b })}
                          title="Archive history"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {showRestores && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <div className="px-4 py-3 border-b text-sm font-medium">
              Restore History ({filteredRestores.length})
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Restore ID</TableHead>
                  <TableHead>Backup</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>E-Sign</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRestores.length === 0 ? (
                  <TableRow><TableCell colSpan={8}><EmptyState title="No restore history" /></TableCell></TableRow>
                ) : pagedRestores.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.restoreId}</TableCell>
                    <TableCell className="text-xs">{r.backupId}</TableCell>
                    <TableCell className="text-xs">{r.restoreType}{r.dryRun ? ' (Dry Run)' : ''}</TableCell>
                    <TableCell><BackupStatusBadge status={r.restoreStatus} /></TableCell>
                    <TableCell className="text-xs">{r.recordsRestored}</TableCell>
                    <TableCell className="font-mono text-[10px] max-w-[100px] truncate">{r.esignRecordId || '—'}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(r.restoreDateTime).slice(0, 19)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/admin/backup/history/restore/${r.id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                      {canArchive && !r.isArchived && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setArchiveTarget({ kind: 'restore', row: r })}
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          Showing page {currentPage + 1} · {filteredBackups.length} backups · {filteredRestores.length} restores
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= Math.max(backupPages, restorePages) - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog open={!!archiveTarget} onOpenChange={(o) => { if (!o) setArchiveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive History Record</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Creates an immutable archive copy. Original remains non-editable and non-deletable; flagged as archived for retention.
          </p>
          <Textarea
            rows={3}
            value={archiveReason}
            onChange={(e) => setArchiveReason(e.target.value)}
            placeholder="GMP archive reason (min 5 characters)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>Cancel</Button>
            <Button disabled={archiveBusy} onClick={runArchive}>
              {archiveBusy ? 'Archiving…' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
