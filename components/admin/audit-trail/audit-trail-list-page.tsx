'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, Download, Eye, Printer, FileSpreadsheet, Shield, Archive,
  ShieldCheck, Calendar, ChevronDown, ChevronUp, Link2, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ModuleBadge } from '@/components/admin/workflows/module-badge';
import { ActionTypeBadge } from './action-type-badge';
import { AuditTrailCharts } from './audit-trail-charts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import {
  canExportAuditTrail, canArchiveAuditTrail, canVerifyAuditIntegrity,
} from '@/lib/permissions';
import {
  AUDIT_TRAIL_MODULES, AUDIT_ACTION_TYPES, AUDIT_LOG_STATUSES,
} from '@/lib/admin/constants';
import type { AuditTrailEntry } from '@/lib/admin/schemas';
import {
  subscribeToAuditTrail,
  fetchAuditTrailEntries,
  filterAuditTrailByRole,
  applyAuditTrailFilters,
  applyAuditListTab,
  getAuditTrailSummary,
  getAuditChartsData,
  exportAuditTrailExcel,
  openAuditTrailPdfReport,
  logAuditTrailExport,
  archiveAuditTrail,
  verifyAuditIntegrity,
  getAuditIntegrityStatus,
  buildPeriodReportEntries,
  type AuditTrailFilters,
  type AuditListTab,
} from '@/lib/admin/audit-trail-service';
import { fetchDepartments } from '@/lib/admin/department-service';
import { fetchCompanySites } from '@/lib/admin/company-site-service';

const PAGE_SIZE = 15;

const LIST_TABS: { value: AuditListTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'login', label: 'Login' },
  { value: 'logout', label: 'Logout' },
  { value: 'failed-login', label: 'Failed Login' },
  { value: 'approvals', label: 'Approvals' },
  { value: 'esign', label: 'E-Sign' },
  { value: 'config', label: 'Config' },
  { value: 'exports', label: 'Exports' },
  { value: 'archived', label: 'Archived' },
];

export function AuditTrailListPage() {
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canExport = canExportAuditTrail(role);
  const canArchive = canArchiveAuditTrail(role);
  const canVerify = canVerifyAuditIntegrity(role);

  const [entries, setEntries] = useState<AuditTrailEntry[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AuditListTab>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [recordIdFilter, setRecordIdFilter] = useState('');
  const [docNumberFilter, setDocNumberFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [esignFilter, setEsignFilter] = useState('all');

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBeforeDate, setArchiveBeforeDate] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);

  const [verifyLoading, setVerifyLoading] = useState(false);
  const [integrityStatus, setIntegrityStatus] = useState<{
    lastIntegrityHash: string | null;
    lastAuditId: string | null;
    updatedAt: string | null;
    chainInitialized: boolean;
  } | null>(null);
  const [integrityLoading, setIntegrityLoading] = useState(true);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
    role,
    department: profile?.department || '',
  };

  const fallbackFetch = useCallback(async () => {
    try {
      const list = await fetchAuditTrailEntries(activeTab === 'archived');
      const scoped = filterAuditTrailByRole(list, role, user?.uid);
      setEntries(scoped);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeTab, role, user?.uid]);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToAuditTrail(
      (data) => {
        // Live subscription covers active trail; archived tab uses explicit fetch
        if (activeTab === 'archived') return;
        const scoped = filterAuditTrailByRole(data, role, user?.uid);
        setEntries(scoped);
        setError(null);
        setLoading(false);
      },
      () => {
        fallbackFetch();
      },
    );
    return () => unsub();
  }, [role, user?.uid, fallbackFetch, activeTab]);

  useEffect(() => {
    if (activeTab === 'archived') {
      fallbackFetch();
    }
  }, [activeTab, fallbackFetch]);

  useEffect(() => {
    Promise.all([
      fetchDepartments(),
      fetchCompanySites(),
    ]).then(([depts, companySites]) => {
      setDepartments(
        Array.from(new Set(depts.map((d) => d.departmentName.trim()).filter(Boolean)))
          .sort((a, b) => a.localeCompare(b)),
      );
      const siteNames = companySites
        .map((s) => s.siteName?.trim() || s.companyName?.trim())
        .filter(Boolean) as string[];
      setSites(Array.from(new Set(siteNames)).sort((a, b) => a.localeCompare(b)));
    }).catch(() => {
      // non-blocking
    });
  }, []);

  useEffect(() => {
    setIntegrityLoading(true);
    getAuditIntegrityStatus()
      .then(setIntegrityStatus)
      .finally(() => setIntegrityLoading(false));
  }, []);

  const filters: AuditTrailFilters = useMemo(() => ({
    search,
    moduleName: moduleFilter,
    actionType: actionFilter,
    status: statusFilter,
    userId: userFilter,
    department: deptFilter,
    site: siteFilter,
    recordId: recordIdFilter,
    documentNumber: docNumberFilter,
    startDate,
    endDate,
    ipAddress: ipFilter,
    eSignature: esignFilter,
  }), [
    search, moduleFilter, actionFilter, statusFilter, userFilter, deptFilter,
    siteFilter, recordIdFilter, docNumberFilter, startDate, endDate, ipFilter, esignFilter,
  ]);

  const tabbed = useMemo(
    () => applyAuditListTab(entries, activeTab),
    [entries, activeTab],
  );
  const filtered = useMemo(
    () => applyAuditTrailFilters(tabbed, filters),
    [tabbed, filters],
  );
  const stats = useMemo(() => getAuditTrailSummary(filtered), [filtered]);
  const charts = useMemo(() => getAuditChartsData(filtered), [filtered]);

  const users = useMemo(() => {
    const map = new Map<string, string>();
    entries.forEach((e) => {
      if (e.changedByUserId) map.set(e.changedByUserId, e.changedByUserName);
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const entrySites = useMemo(() => {
    const fromEntries = entries.map((e) => e.site).filter(Boolean);
    return Array.from(new Set([...sites, ...fromEntries])).sort((a, b) => a.localeCompare(b));
  }, [entries, sites]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const resetPage = () => setPage(0);

  const handleExcelExport = async () => {
    const csv = exportAuditTrailExcel(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logAuditTrailExport(auditMeta, 'Excel', filtered.length);
    toast.success('Audit trail exported (Excel-compatible CSV)');
  };

  const handlePdfExport = async () => {
    openAuditTrailPdfReport(filtered, filters, auditMeta.userName);
    await logAuditTrailExport(auditMeta, 'PDF', filtered.length);
    toast.success('PDF report opened — use Print to save');
  };

  const handlePrint = async () => {
    openAuditTrailPdfReport(filtered, filters, auditMeta.userName);
    await logAuditTrailExport(auditMeta, 'Print', filtered.length);
    toast.success('Print view opened');
  };

  const handlePeriodReport = async (period: 'daily' | 'weekly' | 'monthly') => {
    const periodEntries = buildPeriodReportEntries(entries, period);
    const scoped = applyAuditTrailFilters(
      applyAuditListTab(periodEntries, activeTab),
      filters,
    );
    const titles = {
      daily: 'Daily Audit Trail Report',
      weekly: 'Weekly Audit Trail Report',
      monthly: 'Monthly Audit Trail Report',
    };
    openAuditTrailPdfReport(scoped, filters, auditMeta.userName, titles[period]);
    await logAuditTrailExport(auditMeta, 'PDF', scoped.length);
    toast.success(`${titles[period]} opened`);
  };

  const handleArchive = async () => {
    if (!archiveBeforeDate) {
      toast.error('Select a date before which records will be archived');
      return;
    }
    if (archiveReason.trim().length < 5) {
      toast.error('Archive reason must be at least 5 characters');
      return;
    }
    setArchiveLoading(true);
    const result = await archiveAuditTrail(archiveBeforeDate, archiveReason.trim());
    setArchiveLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Archived ${result.archived} audit record(s)`);
    setArchiveOpen(false);
    setArchiveBeforeDate('');
    setArchiveReason('');
    fallbackFetch();
  };

  const handleVerifyIntegrity = async () => {
    setVerifyLoading(true);
    const result = await verifyAuditIntegrity(100);
    setVerifyLoading(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.mismatches > 0) {
      toast.error(
        `Integrity check failed: ${result.mismatches} mismatch(es) in ${result.checked} records`,
        { description: result.issues.slice(0, 3).join('; ') },
      );
    } else {
      toast.success(
        `Integrity verified: ${result.verified}/${result.checked} records passed`,
      );
    }
    getAuditIntegrityStatus().then(setIntegrityStatus);
  };

  const clearFilters = () => {
    setSearch('');
    setModuleFilter('all');
    setActionFilter('all');
    setStatusFilter('all');
    setUserFilter('all');
    setDeptFilter('all');
    setSiteFilter('all');
    setRecordIdFilter('');
    setDocNumberFilter('');
    setStartDate('');
    setEndDate('');
    setIpFilter('');
    setEsignFilter('all');
    resetPage();
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Audit Trail" basePath="/admin" />
        <LoadingSkeleton rows={3} />
      </div>
    );
  }

  if (error && entries.length === 0) {
    return <ErrorCard message={error} onRetry={fallbackFetch} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Trail"
        description="GMP & 21 CFR Part 11 compliant immutable audit log — ALCOA+ data integrity"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap justify-end">
            {canExport && (
              <>
                <Button variant="outline" size="sm" onClick={handleExcelExport}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" />
                  Export Excel
                </Button>
                <Button variant="outline" size="sm" onClick={handlePdfExport}>
                  <Download className="h-4 w-4 mr-1" />
                  Export PDF
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-1" />
                  Print
                </Button>
              </>
            )}
            {canExport && (
              <>
                <Button variant="outline" size="sm" onClick={() => handlePeriodReport('daily')}>
                  <Calendar className="h-4 w-4 mr-1" />
                  Daily Report
                </Button>
                <Button variant="outline" size="sm" onClick={() => handlePeriodReport('weekly')}>
                  <Calendar className="h-4 w-4 mr-1" />
                  Weekly Report
                </Button>
                <Button variant="outline" size="sm" onClick={() => handlePeriodReport('monthly')}>
                  <Calendar className="h-4 w-4 mr-1" />
                  Monthly Report
                </Button>
              </>
            )}
            {canArchive && (
              <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
                <Archive className="h-4 w-4 mr-1" />
                Archive
              </Button>
            )}
            {canVerify && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleVerifyIntegrity}
                disabled={verifyLoading}
              >
                {verifyLoading ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4 mr-1" />
                )}
                Verify Integrity
              </Button>
            )}
          </div>
        }
      />

      <Card className="border-amber-200 bg-gradient-to-r from-amber-50/80 to-orange-50/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Shield className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            Audit trail records are append-only, tamper-proof, and read-only. No edit or delete
            actions are available. Firestore rules block client-side update/delete on audit collections.
          </p>
        </CardContent>
      </Card>

      {(canVerify || integrityStatus) && (
        <Card className="border-teal-200 bg-teal-50/30">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Link2 className="h-5 w-5 text-teal-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-teal-900">Integrity Chain Status</p>
                  {integrityLoading ? (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading chain status…
                    </p>
                  ) : integrityStatus?.chainInitialized ? (
                    <div className="text-xs text-teal-800/90 mt-1 space-y-0.5 font-mono">
                      <p>Last Audit ID: {integrityStatus.lastAuditId || '—'}</p>
                      <p className="truncate max-w-xl">
                        Last Hash: {integrityStatus.lastIntegrityHash || '—'}
                      </p>
                      {integrityStatus.updatedAt && (
                        <p>Updated: {new Date(integrityStatus.updatedAt).toLocaleString()}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Integrity chain not yet initialized or unavailable.
                    </p>
                  )}
                </div>
              </div>
              {canVerify && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-teal-300"
                  onClick={handleVerifyIntegrity}
                  disabled={verifyLoading}
                >
                  {verifyLoading ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 mr-1" />
                  )}
                  Run Verification
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-3">
        <KpiCard label="Total Logs" value={stats.total} />
        <KpiCard label="Today" value={stats.todayActivities} />
        <KpiCard label="Critical" value={stats.criticalActions} />
        <KpiCard label="Failed Logins" value={stats.failedLogins} />
        <KpiCard label="Approvals" value={stats.approvalActions} />
        <KpiCard label="Rejected" value={stats.rejectedActions} />
        <KpiCard label="Exports" value={stats.exportActions} />
        <KpiCard label="Config Changes" value={stats.systemSettingChanges} />
        <KpiCard label="E-Sign" value={stats.eSignatureActions} />
        <KpiCard label="Has Hash" value={stats.withIntegrityHash} />
      </div>

      <AuditTrailCharts {...charts} />

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as AuditListTab);
          resetPage();
        }}
      >
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          {LIST_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs sm:text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Audit Log Entries</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedFilters((v) => !v)}
            >
              {showAdvancedFilters ? (
                <ChevronUp className="h-4 w-4 mr-1" />
              ) : (
                <ChevronDown className="h-4 w-4 mr-1" />
              )}
              {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search user, module, record, document number, action, audit ID, IP…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); resetPage(); }}
                className="pl-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Module</Label>
              <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); resetPage(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Modules</SelectItem>
                  {AUDIT_TRAIL_MODULES.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Action</Label>
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); resetPage(); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {AUDIT_ACTION_TYPES.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {showAdvancedFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t">
              <div className="space-y-1">
                <Label className="text-xs">User</Label>
                <Select value={userFilter} onValueChange={(v) => { setUserFilter(v); resetPage(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Department</Label>
                <Select value={deptFilter} onValueChange={(v) => { setDeptFilter(v); resetPage(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Site</Label>
                <Select value={siteFilter} onValueChange={(v) => { setSiteFilter(v); resetPage(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sites</SelectItem>
                    {entrySites.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); resetPage(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {AUDIT_LOG_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Record ID</Label>
                <Input
                  value={recordIdFilter}
                  onChange={(e) => { setRecordIdFilter(e.target.value); resetPage(); }}
                  placeholder="Filter by record ID"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Document Number</Label>
                <Input
                  value={docNumberFilter}
                  onChange={(e) => { setDocNumberFilter(e.target.value); resetPage(); }}
                  placeholder="Filter by document number"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); resetPage(); }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); resetPage(); }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">IP Address</Label>
                <Input
                  value={ipFilter}
                  onChange={(e) => { setIpFilter(e.target.value); resetPage(); }}
                  placeholder="Filter by IP"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">E-Signature</Label>
                <Select value={esignFilter} onValueChange={(v) => { setEsignFilter(v); resetPage(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Required</SelectItem>
                    <SelectItem value="no">Not Required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Live sync unavailable — showing cached data. {error}
            </div>
          )}

          <div className="hidden md:block overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Date Time</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState title="No audit records found" message="Try adjusting filters or selecting a different tab." />
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.map((row) => (
                    <TableRow key={row.id || row.auditId} className={row.isArchived ? 'opacity-70' : ''}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {row.dateTime ? new Date(row.dateTime).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <ModuleBadge module={row.moduleName} />
                          {row.subModule && (
                            <p className="text-[10px] text-muted-foreground">{row.subModule}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[140px]">
                        <div className="truncate" title={row.recordId}>{row.recordId || '—'}</div>
                        {row.documentNumber && (
                          <div className="text-[10px] text-muted-foreground truncate" title={row.documentNumber}>
                            {row.documentNumber}
                          </div>
                        )}
                      </TableCell>
                      <TableCell><ActionTypeBadge action={row.actionType} /></TableCell>
                      <TableCell className="text-sm max-w-[120px] truncate" title={row.changedByUserName}>
                        {row.changedByUserName}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.site || '—'}</TableCell>
                      <TableCell><StatusBadge status={row.status} /></TableCell>
                      <TableCell className="text-right">
                        {row.id ? (
                          <Button asChild variant="ghost" size="icon">
                            <Link href={`/admin/audit-trail/${row.id}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {paginated.length === 0 ? (
              <EmptyState title="No audit records found" />
            ) : (
              paginated.map((row) => (
                <Card key={row.id || row.auditId} className="border">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <ActionTypeBadge action={row.actionType} />
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {row.dateTime ? new Date(row.dateTime).toLocaleString() : '—'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <ModuleBadge module={row.moduleName} />
                    </div>
                    <p className="text-sm">{row.changedByUserName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{row.recordId}</p>
                    {row.id && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/audit-trail/${row.id}`}>View Details</Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <div className="flex flex-wrap justify-between items-center gap-2 text-xs text-muted-foreground">
            <span>{filtered.length} audit record{filtered.length !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </Button>
              <span>Page {currentPage + 1} / {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Audit Trail Records</DialogTitle>
            <DialogDescription>
              Move audit records before the selected date to archive storage. This action is logged
              and requires a documented reason (minimum 5 characters).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Archive records before</Label>
              <Input
                type="date"
                value={archiveBeforeDate}
                onChange={(e) => setArchiveBeforeDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Reason for archive</Label>
              <Textarea
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="Document why these records are being archived (min. 5 characters)"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)} disabled={archiveLoading}>
              Cancel
            </Button>
            <Button onClick={handleArchive} disabled={archiveLoading}>
              {archiveLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Archiving…
                </>
              ) : (
                'Archive Records'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
