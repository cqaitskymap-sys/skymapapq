'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, Download, Eye, Printer, FileSpreadsheet, Archive, Shield,
  LogOut, ChevronDown, ChevronUp, Loader2, Calendar,
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import {
  canExportLoginActivity, canManageLoginSessions, canArchiveLoginActivity,
} from '@/lib/permissions';
import {
  LOGIN_STATUSES, LOGIN_EVENT_TYPES, LOGIN_RISK_LEVELS, DEPARTMENT_TYPES,
} from '@/lib/admin/constants';
import type { LoginActivity } from '@/lib/admin/schemas';
import {
  subscribeToLoginActivities, fetchLoginActivities,
  applyLoginActivityFilters, applyLoginListTab, getLoginActivitySummary,
  exportLoginActivityCsv, openLoginActivityPdfReport, logLoginActivityExport,
  archiveLoginActivity, terminateSession, buildPeriodLoginEntries,
  type LoginListTab, type LoginActivityFilters,
} from '@/lib/admin/login-activity-service';

const PAGE_SIZE = 15;

const LIST_TABS: { value: LoginListTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active Sessions' },
  { value: 'history', label: 'Login History' },
  { value: 'logout', label: 'Logout' },
  { value: 'failed', label: 'Failed' },
  { value: 'locked', label: 'Locked' },
  { value: 'security', label: 'Security' },
  { value: 'devices', label: 'Devices' },
  { value: 'archived', label: 'Archived' },
];

export function LoginActivityListPage() {
  const { profile } = useAuth();
  const { role } = useAdminPermissions();
  const canExport = canExportLoginActivity(role);
  const canManage = canManageLoginSessions(role);
  const canArchive = canArchiveLoginActivity(role);

  const [rows, setRows] = useState<LoginActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LoginListTab>('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(0);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [ipFilter, setIpFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBeforeDate, setArchiveBeforeDate] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [terminateTarget, setTerminateTarget] = useState<LoginActivity | null>(null);
  const [terminateReason, setTerminateReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const generatedBy = profile?.full_name || profile?.email || 'Admin';

  const fallbackFetch = useCallback(async () => {
    try {
      const list = await fetchLoginActivities(activeTab === 'archived');
      setRows(list);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setLoading(true);
    if (activeTab === 'archived') {
      void fallbackFetch();
      return undefined;
    }
    const unsub = subscribeToLoginActivities(
      (data) => {
        setRows(data);
        setError(null);
        setLoading(false);
      },
      () => { void fallbackFetch(); },
    );
    return () => unsub();
  }, [fallbackFetch, activeTab]);

  const filters: LoginActivityFilters = useMemo(() => ({
    search,
    loginStatus: statusFilter,
    eventType: eventFilter,
    department: deptFilter,
    riskLevel: riskFilter,
    ipAddress: ipFilter,
    startDate,
    endDate,
  }), [search, statusFilter, eventFilter, deptFilter, riskFilter, ipFilter, startDate, endDate]);

  const tabbed = useMemo(() => applyLoginListTab(rows, activeTab), [rows, activeTab]);
  const filtered = useMemo(() => applyLoginActivityFilters(tabbed, filters), [tabbed, filters]);
  const summary = useMemo(() => getLoginActivitySummary(rows.filter((r) => !r.isArchived)), [rows]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [activeTab, filters]);

  const handleExport = async (format: 'Excel' | 'PDF' | 'Print') => {
    if (!canExport) return;
    if (format === 'Excel') {
      const csv = exportLoginActivityCsv(filtered);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `login-activity-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      openLoginActivityPdfReport(filtered, `${format === 'Print' ? 'Login Activity' : 'Login Activity Report'}`, generatedBy);
    }
    await logLoginActivityExport(format, filtered.length);
    toast.success(`Exported ${filtered.length} record(s)`);
  };

  const handlePeriodReport = (period: 'daily' | 'weekly' | 'monthly') => {
    const subset = buildPeriodLoginEntries(filtered, period);
    openLoginActivityPdfReport(
      subset,
      `${period[0].toUpperCase()}${period.slice(1)} Login Report`,
      generatedBy,
    );
    void logLoginActivityExport('PDF', subset.length);
  };

  const runArchive = async () => {
    if (archiveReason.trim().length < 5 || !archiveBeforeDate) {
      toast.error('Before date and reason (min 5 chars) are required');
      return;
    }
    setArchiveLoading(true);
    const result = await archiveLoginActivity(archiveBeforeDate, archiveReason.trim());
    setArchiveLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`Archived ${result.archived} record(s)`);
      setArchiveOpen(false);
      setArchiveReason('');
      fallbackFetch();
    }
  };

  const runTerminate = async () => {
    if (!terminateTarget?.id || terminateReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionLoading(true);
    const result = await terminateSession(terminateTarget.id, terminateReason.trim());
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Session terminated');
      setTerminateTarget(null);
      setTerminateReason('');
    }
  };

  if (loading && rows.length === 0) return <LoadingSkeleton rows={4} />;
  if (error && rows.length === 0) return <ErrorCard message={error} onRetry={fallbackFetch} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Login Activity"
        description="Immutable session monitoring, failed-login tracking, and security events"
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail"><Shield className="h-4 w-4 mr-1" />Audit Trail</Link>
            </Button>
            {canExport && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleExport('Excel')}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" />Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('PDF')}>
                  <Download className="h-4 w-4 mr-1" />PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('Print')}>
                  <Printer className="h-4 w-4 mr-1" />Print
                </Button>
              </>
            )}
            {canArchive && (
              <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
                <Archive className="h-4 w-4 mr-1" />Archive
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard label="Total" value={summary.total} />
        <KpiCard label="Active" value={summary.activeSessions} />
        <KpiCard label="Today" value={summary.todayLogins} />
        <KpiCard label="Failed" value={summary.failedLogins} />
        <KpiCard label="Locked" value={summary.lockedEvents} />
        <KpiCard label="High Risk" value={summary.highRisk} />
        <KpiCard label="New Device" value={summary.newDevices} />
        <KpiCard label="Forced Out" value={summary.forcedLogouts} />
      </div>

      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-3 text-sm text-amber-950 flex items-center gap-2">
          <Shield className="h-4 w-4 shrink-0" />
          Read-only immutable login history. Records cannot be edited or deleted. Writes are Cloud Function only.
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => handlePeriodReport('daily')}>
          <Calendar className="h-4 w-4 mr-1" />Daily
        </Button>
        <Button variant="outline" size="sm" onClick={() => handlePeriodReport('weekly')}>Weekly</Button>
        <Button variant="outline" size="sm" onClick={() => handlePeriodReport('monthly')}>Monthly</Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LoginListTab)}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {LIST_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search user, email, IP, session…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {LOGIN_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            Filters
          </Button>
        </div>

        {showAdvanced && (
          <Card>
            <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <Label>Event Type</Label>
                <Select value={eventFilter} onValueChange={setEventFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Events</SelectItem>
                    {LOGIN_EVENT_TYPES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Department</Label>
                <Select value={deptFilter} onValueChange={setDeptFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {DEPARTMENT_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Risk</Label>
                <Select value={riskFilter} onValueChange={setRiskFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {LOGIN_RISK_LEVELS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>IP Address</Label>
                <Input value={ipFilter} onChange={(e) => setIpFilter(e.target.value)} />
              </div>
              <div>
                <Label>From</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label>To</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>IP / Device</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState title="No login records" message="Try another tab or adjust filters." />
                  </TableCell>
                </TableRow>
              ) : paginated.map((row) => (
                <TableRow key={row.id || row.loginId} className={row.isArchived ? 'opacity-70' : ''}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {row.loginTime ? new Date(row.loginTime).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{row.userName || row.email}</div>
                    <div className="text-xs text-muted-foreground">{row.role || '—'} · {row.department || '—'}</div>
                  </TableCell>
                  <TableCell><StatusBadge status={row.loginStatus} /></TableCell>
                  <TableCell className="text-xs">{row.eventType || '—'}</TableCell>
                  <TableCell className="text-xs">
                    <div>{row.ipAddress || '—'}</div>
                    <div className="text-muted-foreground">{row.browser || row.deviceType || row.deviceInfo?.slice(0, 40)}</div>
                  </TableCell>
                  <TableCell className="text-xs">{row.riskLevel}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/login-activity/${row.id}`}><Eye className="h-4 w-4" /></Link>
                    </Button>
                    {canManage && row.status === 'Active' && row.id && (
                      <Button variant="ghost" size="sm" onClick={() => setTerminateTarget(row)}>
                        <LogOut className="h-4 w-4 text-red-600" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{filtered.length} record(s)</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <span>Page {currentPage + 1} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Login Records</DialogTitle>
            <DialogDescription>Copies aged records to archive. Originals remain immutable.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Before date</Label>
              <Input type="date" value={archiveBeforeDate} onChange={(e) => setArchiveBeforeDate(e.target.value)} />
            </div>
            <div>
              <Label>Change reason</Label>
              <Textarea value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button onClick={runArchive} disabled={archiveLoading}>
              {archiveLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(terminateTarget)} onOpenChange={(o) => !o && setTerminateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminate Session</DialogTitle>
            <DialogDescription>
              Force logout for {terminateTarget?.userName}. Requires change reason.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={terminateReason} onChange={(e) => setTerminateReason(e.target.value)} rows={2} placeholder="Reason (min 5 characters)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={runTerminate} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Terminate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
