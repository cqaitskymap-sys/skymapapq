'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Search, Download, Eye, Printer, Archive, Shield, Loader2,
  ChevronDown, ChevronUp, Plus, AlertTriangle, RefreshCw, Users,
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
  canExportAccessReview, canManageAccessReview, canArchiveAccessReview,
  canGenerateAccessReviewCampaign,
} from '@/lib/permissions';
import {
  ACCESS_REVIEW_STATUSES, ACCESS_REVIEW_RISK_LEVELS, DEPARTMENT_TYPES,
} from '@/lib/admin/constants';
import type { AccessReview } from '@/lib/admin/schemas';
import {
  subscribeToAccessReviews, fetchAccessReviews,
  applyAccessReviewFilters, applyAccessReviewTab, getAccessReviewSummary,
  exportAccessReviewCsv, openAccessReviewPdfReport, logAccessReviewExport,
  archiveAccessReviews, generateAccessReviewCampaign, analyzeAccessRisks,
  markAccessReviewsOverdue, createAccessReview,
  type AccessReviewTab, type AccessReviewFilters,
} from '@/lib/admin/access-review-service';
import { getAdminRecords } from '@/lib/admin/admin-service';
import { ADMIN_COLLECTIONS } from '@/lib/admin/constants';

const PAGE_SIZE = 15;

const LIST_TABS: { value: AccessReviewTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'privileged', label: 'Privileged' },
  { value: 'sod', label: 'SoD / Critical' },
  { value: 'archived', label: 'Archived' },
];

export function AccessReviewListPage() {
  const { profile } = useAuth();
  const { role } = useAdminPermissions();
  const canExport = canExportAccessReview(role);
  const canManage = canManageAccessReview(role);
  const canArchive = canArchiveAccessReview(role);
  const canCampaign = canGenerateAccessReviewCampaign(role);

  const [rows, setRows] = useState<AccessReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AccessReviewTab>('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<Array<{ id: string; fullName: string; role: string }>>([]);
  const [reviewPeriod, setReviewPeriod] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [privilegedOnly, setPrivilegedOnly] = useState(false);
  const [archiveBefore, setArchiveBefore] = useState('');
  const [riskSummary, setRiskSummary] = useState<Record<string, number> | null>(null);

  const generatedBy = profile?.full_name || profile?.email || 'Admin';

  const fallbackFetch = useCallback(async () => {
    try {
      const list = await fetchAccessReviews(activeTab === 'archived');
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
    const unsub = subscribeToAccessReviews(
      (data) => {
        setRows(data);
        setError(null);
        setLoading(false);
      },
      () => { void fallbackFetch(); },
    );
    return () => unsub();
  }, [fallbackFetch, activeTab]);

  useEffect(() => {
    if (!canManage) return;
    void getAdminRecords(ADMIN_COLLECTIONS.users).then((list) => {
      setUsers(list.slice(0, 300).map((u) => ({
        id: String(u.id || ''),
        fullName: String(u.fullName || u.userName || u.email || u.id || ''),
        role: String(u.role || ''),
      })).filter((u) => u.id));
    }).catch(() => undefined);
  }, [canManage]);

  const filters: AccessReviewFilters = useMemo(() => ({
    search,
    reviewStatus: statusFilter,
    department: deptFilter,
    riskLevel: riskFilter,
    period: periodFilter || undefined,
  }), [search, statusFilter, deptFilter, riskFilter, periodFilter]);

  const tabbed = useMemo(() => applyAccessReviewTab(rows, activeTab), [rows, activeTab]);
  const filtered = useMemo(() => applyAccessReviewFilters(tabbed, filters), [tabbed, filters]);
  const summary = useMemo(() => getAccessReviewSummary(rows), [rows]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [activeTab, filters]);

  const handleExport = async (format: 'Excel' | 'PDF' | 'Print') => {
    if (!canExport) return;
    if (format === 'Excel') {
      const csv = exportAccessReviewCsv(filtered);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `access-review-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      openAccessReviewPdfReport(filtered, 'User Access Review Report', generatedBy);
    }
    await logAccessReviewExport(format, filtered.length);
    toast.success(`Exported ${filtered.length} record(s)`);
  };

  const runCreate = async () => {
    if (!userId || !reviewPeriod || changeReason.trim().length < 5) {
      toast.error('User, period, and reason (min 5 chars) are required');
      return;
    }
    setActionLoading(true);
    const result = await createAccessReview({
      userId, reviewPeriod, dueDate, changeReason: changeReason.trim(),
    });
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`Created ${result.data?.reviewId}`);
      setCreateOpen(false);
      setChangeReason('');
    }
  };

  const runCampaign = async () => {
    if (!reviewPeriod || changeReason.trim().length < 5) {
      toast.error('Period and reason (min 5 chars) are required');
      return;
    }
    setActionLoading(true);
    const result = await generateAccessReviewCampaign({
      reviewPeriod, dueDate, includeInactive, privilegedOnly, changeReason: changeReason.trim(),
    });
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`Created ${result.data?.created} reviews (${result.data?.skipped} skipped)`);
      setCampaignOpen(false);
    }
  };

  const runArchive = async () => {
    if (!archiveBefore || changeReason.trim().length < 5) {
      toast.error('Before date and reason required');
      return;
    }
    setActionLoading(true);
    const result = await archiveAccessReviews(archiveBefore, changeReason.trim());
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`Archived ${result.data?.archived || 0} reviews`);
      setArchiveOpen(false);
    }
  };

  const runAnalyze = async () => {
    setActionLoading(true);
    const result = await analyzeAccessRisks();
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      const s = (result.data?.summary || {}) as Record<string, number>;
      setRiskSummary(s);
      toast.success('Access risk analysis complete');
    }
  };

  const runOverdue = async () => {
    setActionLoading(true);
    const result = await markAccessReviewsOverdue();
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else toast.success(`Marked ${result.data?.marked || 0} overdue`);
  };

  if (loading && rows.length === 0) return <LoadingSkeleton rows={4} />;
  if (error && rows.length === 0) return <ErrorCard message={error} onRetry={fallbackFetch} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Access Review"
        description="Periodic access reviews for GMP / 21 CFR Part 11 / ISO 27001 / SOX"
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail"><Shield className="h-4 w-4 mr-1" />Audit Trail</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/login-activity">Login Activity</Link>
            </Button>
            {canExport && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleExport('Excel')}>
                  <Download className="h-4 w-4 mr-1" />Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('PDF')}>
                  <Printer className="h-4 w-4 mr-1" />PDF
                </Button>
              </>
            )}
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={runAnalyze} disabled={actionLoading}>
                  <AlertTriangle className="h-4 w-4 mr-1" />Analyze Risks
                </Button>
                <Button variant="outline" size="sm" onClick={runOverdue} disabled={actionLoading}>
                  <RefreshCw className="h-4 w-4 mr-1" />Mark Overdue
                </Button>
                <Button size="sm" onClick={() => { setChangeReason(''); setCreateOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" />New Review
                </Button>
              </>
            )}
            {canCampaign && (
              <Button variant="outline" size="sm" onClick={() => { setChangeReason(''); setCampaignOpen(true); }}>
                <Users className="h-4 w-4 mr-1" />Campaign
              </Button>
            )}
            {canArchive && (
              <Button variant="outline" size="sm" onClick={() => { setChangeReason(''); setArchiveOpen(true); }}>
                <Archive className="h-4 w-4 mr-1" />Archive
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard label="Total" value={summary.total} />
        <KpiCard label="Pending" value={summary.pending} />
        <KpiCard label="In Progress" value={summary.inProgress} />
        <KpiCard label="Overdue" value={summary.overdue} />
        <KpiCard label="Completed" value={summary.completed} />
        <KpiCard label="Rejected" value={summary.rejected} />
        <KpiCard label="Privileged" value={summary.privileged} />
        <KpiCard label="Critical" value={summary.critical} />
      </div>

      {riskSummary && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="p-3 text-sm flex flex-wrap gap-4">
            <span>Orphans: {riskSummary.orphanAccounts ?? 0}</span>
            <span>Inactive: {riskSummary.inactiveUsers ?? 0}</span>
            <span>Privileged: {riskSummary.privilegedUsers ?? 0}</span>
            <span>Temporary: {riskSummary.temporaryAccess ?? 0}</span>
            <span>Duplicates/SoD: {riskSummary.duplicateOrSod ?? 0}</span>
          </CardContent>
        </Card>
      )}

      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-3 text-sm text-amber-950 flex items-center gap-2">
          <Shield className="h-4 w-4 shrink-0" />
          Workflow-controlled reviews. Completion requires electronic signature. Completed records are immutable.
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AccessReviewTab)}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {LIST_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs">{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search review ID, user, employee ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAdvanced((s) => !s)}>
            {showAdvanced ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            Filters
          </Button>
        </div>
        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 border rounded-lg bg-slate-50/50">
            <div>
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {ACCESS_REVIEW_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                  {ACCESS_REVIEW_RISK_LEVELS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Period</Label>
              <Input value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} placeholder="e.g. 2026-Q1" />
            </div>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {paginated.length === 0 ? (
            <div className="p-8"><EmptyState title="No access reviews" message="Create a review or generate a campaign." /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Review ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.reviewId}</TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">{row.userName}</p>
                      <p className="text-xs text-muted-foreground">{row.employeeId || row.email}</p>
                    </TableCell>
                    <TableCell className="text-sm">{row.role}</TableCell>
                    <TableCell className="text-sm">{row.reviewPeriod}</TableCell>
                    <TableCell><StatusBadge status={row.reviewStatus} /></TableCell>
                    <TableCell className="text-sm">{row.riskLevel}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{row.dueDate || '-'}</TableCell>
                    <TableCell className="text-sm">{row.reviewerName}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/admin/user-access-review/${row.id}`}><Eye className="h-4 w-4" /></Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Access Review</DialogTitle>
            <DialogDescription>Creates a Pending review linked to a user master record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>User</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.fullName} ({u.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Review Period</Label>
              <Input value={reviewPeriod} onChange={(e) => setReviewPeriod(e.target.value)} placeholder="2026-Q1" />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label>Change reason</Label>
              <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={runCreate} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Review Campaign</DialogTitle>
            <DialogDescription>Creates Pending reviews for users in the selected period.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Review Period</Label>
              <Input value={reviewPeriod} onChange={(e) => setReviewPeriod(e.target.value)} placeholder="2026-Q1" />
            </div>
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Include inactive users
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={privilegedOnly} onChange={(e) => setPrivilegedOnly(e.target.checked)} />
              Privileged roles only
            </label>
            <div>
              <Label>Change reason</Label>
              <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampaignOpen(false)}>Cancel</Button>
            <Button onClick={runCampaign} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Completed Reviews</DialogTitle>
            <DialogDescription>Copies completed/closed reviews to archive. Originals marked Archived.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Before date</Label>
              <Input type="date" value={archiveBefore} onChange={(e) => setArchiveBefore(e.target.value)} />
            </div>
            <div>
              <Label>Change reason</Label>
              <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button onClick={runArchive} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
