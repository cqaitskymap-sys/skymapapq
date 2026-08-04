'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Bell, CheckCircle2, Eye, FileSpreadsheet, FileText,
  Plus, Printer, RefreshCw, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase';
import { printPage } from '@/lib/export-utils';
import {
  PQR_FILTER_STATUSES, canExportPqrDashboard, completionStatusColor, isPqrDashboardViewOnly,
  type PqrDashboardData, type PqrDashboardFilters,
} from '@/lib/pqr-dashboard-records';
import {
  exportPqrDashboardData, fetchPqrDashboard, fetchPqrFilterOptions,
  logPqrDashboardFilter, logPqrDashboardView, logPqrOpened, refreshPqrDashboard,
} from '@/lib/pqr-dashboard-service';
import { subscribeToNotifications, type NotificationRecord } from '@/lib/notification-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { PqrDashboardAccessGuard } from './pqr-dashboard-access-guard';
import { PqrRiskBadge, PqrStatusBadge } from './pqr-dashboard-badges';
import { ActivityTimeline } from './activity-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ColumnDef } from '@/components/admin/admin-data-table';
import type {
  PqrActionItemRow, PqrCompletionRow, PqrCriticalAlertRow, PqrDueRow,
  PqrFindingRow, PqrPendingApprovalRow, PqrProductAnalysisRow, PqrRecordRow,
} from '@/lib/pqr-dashboard-records';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#64748b'];

const DEFAULT_FILTERS: PqrDashboardFilters = {
  product: 'all',
  reviewYear: 'all',
  status: 'all',
  site: 'all',
  search: '',
  dateFrom: '',
  dateTo: '',
  overdueOnly: false,
  pendingApprovalOnly: false,
};

const QUICK_LINKS = [
  { label: 'Create PQR', href: '/pqr/create' },
  { label: 'Batch Review', href: '/pqr/batches' },
  { label: 'Material Review', href: '/pqr/materials' },
  { label: 'Packaging', href: '/pqr/packaging' },
  { label: 'Equipment', href: '/pqr/equipment-review' },
  { label: 'Utility', href: '/pqr/utility-review' },
  { label: 'Stability', href: '/pqr/stability' },
  { label: 'Summary', href: '/pqr/summary' },
  { label: 'Approval', href: '/pqr/approval' },
  { label: 'Audit Trail', href: '/dashboard/audit-trail?module=PQR' },
];

function SafeChart({
  title, description, height = 'h-56', children, empty, loading,
}: {
  title: string;
  description?: string;
  height?: string;
  children: React.ReactNode;
  empty?: boolean;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className={height} role="img" aria-label={title}>
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading chart…</div>
        ) : empty ? (
          <EmptyState title="No data" message="No records for the selected filters." />
        ) : children}
      </CardContent>
    </Card>
  );
}

export function PqrDashboardPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canExport = canExportPqrDashboard(role);
  const viewOnly = isPqrDashboardViewOnly(role);

  const [data, setData] = useState<PqrDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [pqrNotifications, setPqrNotifications] = useState<NotificationRecord[]>([]);
  const [filters, setFilters] = useState<PqrDashboardFilters>(DEFAULT_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
  }), [user?.uid, profile?.full_name, profile?.email, role]);

  const loadOptions = useCallback(async () => {
    try {
      const opts = await fetchPqrFilterOptions();
      setProducts(opts.products);
      setYears(opts.years);
      setSites(opts.sites);
    } catch {
      // non-blocking
    }
  }, []);

  const load = useCallback(async (opts?: { refresh?: boolean; nextFilters?: PqrDashboardFilters }) => {
    const activeFilters = opts?.nextFilters || filters;
    if (opts?.refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) {
        setError('Firebase is not configured. Set environment variables to load live PQR data.');
        setData(null);
        return;
      }
      const result = opts?.refresh
        ? await refreshPqrDashboard(actor, activeFilters)
        : await fetchPqrDashboard(activeFilters);
      if (result.error && !result.recentPqrs.length && !result.kpis.totalPqrs) {
        setError(result.error);
        setData(result);
        return;
      }
      setData(result);
      if (result.filterOptions?.products?.length) {
        setProducts(result.filterOptions.products);
        setYears(result.filterOptions.years);
        setSites(result.filterOptions.sites);
      }
    } catch {
      setError('Failed to load PQR dashboard data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [actor, filters]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => {
    void load();
    void logPqrDashboardView(actor);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user?.uid || !isFirebaseConfigured()) return;
    const unsub = subscribeToNotifications(user.uid, (rows) => {
      setPqrNotifications(rows.filter((n) =>
        String(n.moduleName || '').toLowerCase().includes('pqr'),
      ).slice(0, 5));
    });
    return () => unsub();
  }, [user?.uid]);

  const applyFilters = (next?: PqrDashboardFilters) => {
    const merged = next || { ...filters, search: searchDraft };
    setFilters(merged);
    void logPqrDashboardFilter(actor, merged);
    void load({ nextFilters: merged });
    toast.success('Filters applied');
  };

  const resetFilters = () => {
    setSearchDraft('');
    setFilters(DEFAULT_FILTERS);
    void logPqrDashboardFilter(actor, DEFAULT_FILTERS);
    void load({ nextFilters: DEFAULT_FILTERS });
    toast.success('Filters cleared');
  };

  const handleRefresh = () => {
    void load({ refresh: true });
    toast.success('Dashboard refreshed');
  };

  const setStatusFilter = (status: string) => {
    const next = {
      ...filters,
      status,
      overdueOnly: false,
      pendingApprovalOnly: false,
      search: searchDraft,
    };
    setFilters(next);
    void logPqrDashboardFilter(actor, next);
    void load({ nextFilters: next });
  };

  const setQuickFilter = (patch: Partial<PqrDashboardFilters>) => {
    const next = { ...filters, ...patch, search: searchDraft };
    setFilters(next);
    void logPqrDashboardFilter(actor, next);
    void load({ nextFilters: next });
  };

  const exportCsv = async () => {
    if (!data) return;
    try {
      await exportPqrDashboardData(actor, data, 'csv');
      toast.success('CSV exported');
    } catch {
      toast.error('Export failed. Please try again.');
    }
  };

  const exportExcel = async () => {
    if (!data) return;
    try {
      // CSV is Excel-compatible; same payload with excel audit action
      await exportPqrDashboardData(actor, data, 'excel');
      toast.success('Excel-compatible CSV exported');
    } catch {
      toast.error('Export failed. Please try again.');
    }
  };

  const handlePrint = () => {
    printPage();
  };

  const openPqr = (id: string) => {
    if (!id) return;
    void logPqrOpened(actor, id);
    router.push(`/pqr/${id}`);
  };

  const recentColumns: ColumnDef<PqrRecordRow>[] = [
    { key: 'pqrNumber', header: 'PQR Number' },
    { key: 'product', header: 'Product', render: (r) => (
      <button type="button" className="text-left text-blue-700 hover:underline" onClick={() => setQuickFilter({ product: r.product, status: 'all' })}>
        {r.product || '—'}
      </button>
    ) },
    { key: 'reviewPeriod', header: 'Review Period', render: (r) => <span className="line-clamp-1 max-w-[140px]">{r.reviewPeriod || '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <PqrStatusBadge status={r.status} /> },
    { key: 'completionPct', header: 'Completion', render: (r) => (
      <span className="tabular-nums">{r.completionPct ?? 0}%</span>
    ) },
    { key: 'preparedBy', header: 'Prepared By' },
    { key: 'pendingWith', header: 'Pending With' },
    { key: 'createdDate', header: 'Created Date' },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <Button variant="ghost" size="icon" aria-label={`Open ${r.pqrNumber}`} onClick={() => openPqr(r.id)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const dueColumns: ColumnDef<PqrDueRow>[] = [
    { key: 'product', header: 'Product' },
    { key: 'reviewYear', header: 'Review Year' },
    { key: 'dueDate', header: 'Due Date' },
    { key: 'daysOverdue', header: 'Days Overdue', render: (r) => (
      <span className={r.daysOverdue > 0 ? 'font-semibold text-red-600' : ''}>{r.daysOverdue}</span>
    ) },
    { key: 'owner', header: 'Owner' },
    { key: 'status', header: 'Status', render: (r) => <PqrStatusBadge status={r.status} /> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <Button variant="ghost" size="icon" aria-label={`Open overdue PQR for ${r.product}`} onClick={() => openPqr(r.id)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const approvalColumns: ColumnDef<PqrPendingApprovalRow>[] = [
    { key: 'pqrNumber', header: 'PQR Number' },
    { key: 'product', header: 'Product' },
    { key: 'currentStep', header: 'Current Step' },
    { key: 'pendingWith', header: 'Pending With' },
    { key: 'dueDate', header: 'Due Date' },
    { key: 'priority', header: 'Priority', render: (r) => <PqrRiskBadge level={r.priority === 'High' ? 'High' : 'Medium'} /> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Open approval for ${r.pqrNumber}`}
          onClick={() => (r.pqrId ? openPqr(r.pqrId) : router.push('/pqr/approval'))}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const alertColumns: ColumnDef<PqrCriticalAlertRow>[] = [
    { key: 'product', header: 'Product' },
    { key: 'batchNo', header: 'Batch No' },
    { key: 'source', header: 'Source' },
    { key: 'issue', header: 'Issue', render: (r) => <span className="line-clamp-2 max-w-[180px]">{r.issue}</span> },
    { key: 'riskLevel', header: 'Risk Level', render: (r) => <PqrRiskBadge level={r.riskLevel} /> },
    { key: 'status', header: 'Status', render: (r) => <PqrStatusBadge status={r.status} /> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`View ${r.source} alert`}
          onClick={() => r.href && router.push(r.href)}
        >
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        </Button>
      ),
    },
  ];

  const productColumns: ColumnDef<PqrProductAnalysisRow>[] = [
    { key: 'product', header: 'Product', render: (r) => (
      <button type="button" className="text-left font-medium text-blue-700 hover:underline" onClick={() => setQuickFilter({ product: r.product, status: 'all' })}>
        {r.product}
      </button>
    ) },
    { key: 'productCode', header: 'Code' },
    { key: 'pqrCount', header: 'PQRs' },
    { key: 'batchCount', header: 'Batches' },
    { key: 'deviationCount', header: 'Dev' },
    { key: 'oosCount', header: 'OOS' },
    { key: 'ootCount', header: 'OOT' },
    { key: 'capaCount', header: 'CAPA' },
    { key: 'complaintCount', header: 'Complaints' },
    { key: 'changeControlCount', header: 'CC' },
    { key: 'stabilityIssues', header: 'Stab. Issues' },
    { key: 'statuses', header: 'Statuses', render: (r) => <span className="line-clamp-1 max-w-[120px] text-xs">{r.statuses}</span> },
  ];

  const actionColumns: ColumnDef<PqrActionItemRow>[] = [
    { key: 'description', header: 'Action', render: (r) => <span className="line-clamp-2 max-w-[220px]">{r.description}</span> },
    { key: 'source', header: 'Source' },
    { key: 'owner', header: 'Owner' },
    { key: 'dueDate', header: 'Due Date' },
    { key: 'priority', header: 'Priority', render: (r) => <PqrRiskBadge level={r.priority === 'High' || r.priority === 'Critical' ? r.priority : 'Medium'} /> },
    { key: 'status', header: 'Status', render: (r) => <PqrStatusBadge status={r.status} /> },
    {
      key: 'actions', header: 'Open',
      render: (r) => (
        <Button variant="ghost" size="icon" aria-label="Open action source" onClick={() => r.href && router.push(r.href)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const findingColumns: ColumnDef<PqrFindingRow>[] = [
    { key: 'severity', header: 'Severity', render: (r) => <PqrRiskBadge level={r.severity === 'Critical' ? 'Critical' : r.severity === 'Major' ? 'High' : 'Medium'} /> },
    { key: 'category', header: 'Category' },
    { key: 'description', header: 'Finding', render: (r) => <span className="line-clamp-2 max-w-[240px]">{r.description}</span> },
    { key: 'product', header: 'Product' },
    { key: 'count', header: 'Count' },
    {
      key: 'actions', header: 'Open',
      render: (r) => (
        <Button variant="ghost" size="icon" aria-label="Open finding" onClick={() => r.href && router.push(r.href)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const completionColumns: ColumnDef<PqrCompletionRow>[] = [
    { key: 'pqrNumber', header: 'PQR' },
    { key: 'product', header: 'Product' },
    { key: 'status', header: 'Status', render: (r) => <PqrStatusBadge status={r.status} /> },
    { key: 'completionPct', header: 'Progress', render: (r) => (
      <div className="min-w-[120px] space-y-1">
        <div className="flex justify-between text-xs"><span>{r.completionPct}%</span></div>
        <Progress value={r.completionPct} className="h-2" />
      </div>
    ) },
    {
      key: 'actions', header: 'Open',
      render: (r) => (
        <Button variant="ghost" size="icon" aria-label={`Open ${r.pqrNumber}`} onClick={() => openPqr(r.pqrId)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const kpis = data?.kpis;
  const charts = data?.charts;

  if (loading && !data) {
    return (
      <PqrDashboardAccessGuard>
        <div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div>
      </PqrDashboardAccessGuard>
    );
  }

  if (error && !data?.recentPqrs?.length && !kpis?.totalPqrs) {
    return (
      <PqrDashboardAccessGuard>
        <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void load()} /></div>
      </PqrDashboardAccessGuard>
    );
  }

  return (
    <PqrDashboardAccessGuard>
      <div className="space-y-6 p-4 sm:p-6 print:p-2">
        <CpvPageHeader
          title="PQR Dashboard"
          description="Product Quality Review overview, annual review status and quality performance"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'PQR Dashboard' },
          ]}
          actions={(
            <>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} aria-label="Refresh dashboard">
                <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint} aria-label="Print dashboard">
                <Printer className="h-4 w-4 mr-1" />Print
              </Button>
              {canExport && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void exportCsv()} aria-label="Export CSV">
                    <FileText className="h-4 w-4 mr-1" />CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void exportExcel()} aria-label="Export Excel">
                    <FileSpreadsheet className="h-4 w-4 mr-1" />Excel
                  </Button>
                </>
              )}
              {!viewOnly && (
                <Link href="/pqr/create">
                  <Button size="sm"><Plus className="h-4 w-4 mr-1" />Create PQR</Button>
                </Link>
              )}
            </>
          )}
        />

        {/* Quick navigation */}
        <nav aria-label="PQR module navigation" className="flex flex-wrap gap-2">
          {QUICK_LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              <Button variant="secondary" size="sm" className="h-8 text-xs">{l.label}</Button>
            </Link>
          ))}
        </nav>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                className="pl-9"
                placeholder="Search PQR number, product, owner, reviewer…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
                aria-label="Global PQR search"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <Select value={filters.product || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, product: v }))}>
                <SelectTrigger aria-label="Filter by product"><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Products</SelectItem>
                  {products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.reviewYear || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, reviewYear: v }))}>
                <SelectTrigger aria-label="Filter by review year"><SelectValue placeholder="Review Year" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.status || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}>
                <SelectTrigger aria-label="Filter by status"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  {PQR_FILTER_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.site || 'all'} onValueChange={(v) => setFilters((f) => ({ ...f, site: v }))}>
                <SelectTrigger aria-label="Filter by site"><SelectValue placeholder="Site" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sites</SelectItem>
                  {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" aria-label="Date from" value={filters.dateFrom || ''} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
              <Input type="date" aria-label="Date to" value={filters.dateTo || ''} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
              <Button onClick={() => applyFilters()}>Apply Filters</Button>
              <Button variant="outline" onClick={resetFilters} aria-label="Reset filters">
                <X className="h-4 w-4 mr-1" />Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        {kpis && (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
            {[
              { label: 'Total PQRs', value: kpis.totalPqrs, onClick: () => setStatusFilter('all') },
              { label: 'Current Year', value: kpis.currentYearPqrs, onClick: () => setQuickFilter({ reviewYear: String(new Date().getFullYear()), status: 'all' }) },
              { label: 'Previous Year', value: kpis.previousYearPqrs, onClick: () => setQuickFilter({ reviewYear: String(new Date().getFullYear() - 1), status: 'all' }) },
              { label: 'Draft', value: kpis.draftPqrs, tone: 'amber' as const, onClick: () => setStatusFilter('Draft') },
              { label: 'In Progress', value: kpis.inProgressPqrs, tone: 'amber' as const, onClick: () => setStatusFilter('In Progress') },
              { label: 'Under Review', value: kpis.underReviewPqrs, tone: 'amber' as const, onClick: () => setStatusFilter('Under Review') },
              { label: 'Approval Pending', value: kpis.approvalPendingPqrs, tone: 'amber' as const, onClick: () => setStatusFilter('Approval Pending') },
              { label: 'Approved', value: kpis.approvedPqrs, tone: 'green' as const, onClick: () => setStatusFilter('Approved') },
              { label: 'Rejected', value: kpis.rejectedPqrs, tone: 'red' as const, onClick: () => setStatusFilter('Rejected') },
              { label: 'Closed', value: kpis.closedPqrs, tone: 'green' as const, onClick: () => setStatusFilter('Closed') },
              { label: 'Overdue', value: kpis.overduePqrs, tone: 'red' as const, onClick: () => setQuickFilter({ overdueOnly: true, status: 'all', pendingApprovalOnly: false }) },
              { label: 'Due This Month', value: kpis.pqrsDueThisMonth, tone: 'amber' as const },
              { label: 'Completion %', value: `${kpis.completionPct}%`, tone: 'green' as const },
              { label: 'Pending Reviews', value: kpis.pendingReviews, tone: 'amber' as const, onClick: () => setStatusFilter('Under Review') },
              { label: 'Pending Approvals', value: kpis.pendingApprovals, tone: 'amber' as const, onClick: () => setQuickFilter({ pendingApprovalOnly: true, overdueOnly: false, status: 'all' }) },
              { label: 'Critical Findings', value: kpis.criticalFindings, tone: 'red' as const },
              { label: 'Open Actions', value: kpis.openActions, tone: 'amber' as const },
              { label: 'Products Reviewed', value: kpis.totalProductsReviewed },
              { label: 'Batches Reviewed', value: kpis.totalBatchesReviewed },
              { label: 'Released Batches', value: kpis.releasedBatches, tone: 'green' as const },
              { label: 'Rejected Batches', value: kpis.rejectedBatches, tone: 'red' as const },
              { label: 'Deviations', value: kpis.deviationCount, tone: 'amber' as const },
              { label: 'OOS', value: kpis.oosCount, tone: 'red' as const },
              { label: 'OOT', value: kpis.ootCount, tone: 'amber' as const },
              { label: 'CAPA', value: kpis.capaCount },
              { label: 'Change Controls', value: kpis.changeControlCount },
              { label: 'Complaints', value: kpis.marketComplaintCount, tone: 'amber' as const },
              { label: 'Recalls', value: kpis.recallCount, tone: 'red' as const },
              { label: 'Avg Yield %', value: `${kpis.averageYieldPct}%` },
              { label: 'Avg Assay %', value: `${kpis.averageAssayPct}%` },
              { label: 'Avg Cpk', value: kpis.averageCpk },
              { label: 'Open Risks', value: kpis.openRisks, tone: 'red' as const },
            ].map((k) => (
              <button
                key={k.label}
                type="button"
                className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md disabled:cursor-default"
                onClick={k.onClick}
                disabled={!k.onClick}
                aria-label={`${k.label}: ${k.value}`}
              >
                <KpiCard label={k.label} value={k.value} tone={k.tone} />
              </button>
            ))}
          </div>
        )}

        {/* Charts */}
        {charts && (
          <div className="grid gap-4 lg:grid-cols-2">
            <SafeChart title="PQR Status Distribution" empty={!charts.statusDistribution.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={charts.statusDistribution} dataKey="value" nameKey="name" outerRadius={80} label>
                    {charts.statusDistribution.map((_, i) => (
                      <Cell key={charts.statusDistribution[i].name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Monthly PQR Creation Trend" empty={!charts.monthlyCreationTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.monthlyCreationTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} name="Created" />
                </LineChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Product-wise PQR Status" empty={!charts.productStatus.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.productStatus}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="product" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="draft" fill="#64748b" name="Draft" stackId="a" />
                  <Bar dataKey="review" fill="#d97706" name="In Review" stackId="a" />
                  <Bar dataKey="approved" fill="#059669" name="Approved" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Batch Release vs Rejection Trend" empty={!charts.batchReleaseTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.batchReleaseTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="released" fill="#059669" name="Released" />
                  <Bar dataKey="rejected" fill="#dc2626" name="Rejected" />
                </BarChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Deviation / OOS / CAPA Trend" empty={!charts.qualityTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.qualityTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="deviations" stroke="#2563eb" name="Deviations" />
                  <Line type="monotone" dataKey="oos" stroke="#dc2626" name="OOS" />
                  <Line type="monotone" dataKey="capa" stroke="#d97706" name="CAPA" />
                </LineChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="PQR Completion Trend" empty={!charts.completionTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.completionTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#059669" name="Avg Completion %" />
                </LineChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Yield Trend" empty={!charts.yieldTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.yieldTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#059669" name="Yield %" />
                </LineChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Assay Trend" empty={!charts.assayTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.assayTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#2563eb" name="Assay %" />
                </LineChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Stability Trend" empty={!charts.stabilityTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.stabilityTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#7c3aed" name="Result" />
                </LineChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Complaint & Recall Trend" empty={!charts.complaintRecallTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.complaintRecallTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="complaints" fill="#d97706" name="Complaints" />
                  <Bar dataKey="recalls" fill="#dc2626" name="Recalls" />
                </BarChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Approval Pending Trend" empty={!charts.approvalPendingTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.approvalPendingTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#d97706" name="Pending" />
                </LineChart>
              </ResponsiveContainer>
            </SafeChart>

            <SafeChart title="Overdue PQR Trend" empty={!charts.overdueTrend.length} loading={refreshing}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.overdueTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="#dc2626" name="Overdue" />
                </BarChart>
              </ResponsiveContainer>
            </SafeChart>
          </div>
        )}

        {/* Completion tracking */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />PQR Completion Tracking
            </CardTitle>
            <CardDescription>Section progress across Batch, Material, Packaging, Equipment, Utility, Stability, Quality, Summary, and Approval</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data?.completionRows?.length ? (
              <>
                <ResponsiveDataTable
                  columns={completionColumns}
                  data={data.completionRows}
                  searchKeys={['pqrNumber', 'product']}
                  mobileTitleKey="pqrNumber"
                  mobileSubtitleKey="product"
                  pageSize={8}
                />
                {data.completionRows[0] && (
                  <div className="rounded-md border p-3">
                    <p className="mb-2 text-sm font-medium">
                      Section detail — {data.completionRows[0].pqrNumber}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                      {data.completionRows[0].sections.map((s) => (
                        <Link key={s.key} href={s.href} className="rounded-md border p-2 text-xs hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium line-clamp-1">{s.label}</span>
                            <span className={`rounded border px-1.5 py-0.5 ${completionStatusColor(s.status)}`}>{s.status}</span>
                          </div>
                          <p className="mt-1 text-muted-foreground">{s.count} record(s)</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <EmptyState title="No completion data" message="Create or open a PQR to track section progress." />
            )}
          </CardContent>
        </Card>

        {/* Product analysis */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Product-wise Analysis</CardTitle>
            <CardDescription>PQR counts with linked quality events — click a product to filter</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.productAnalysis?.length ? (
              <ResponsiveDataTable
                columns={productColumns}
                data={data.productAnalysis}
                searchKeys={['product', 'productCode']}
                mobileTitleKey="product"
                mobileSubtitleKey="productCode"
                pageSize={10}
              />
            ) : (
              <EmptyState title="No product analysis" message="Product-wise metrics appear once PQR records exist." />
            )}
          </CardContent>
        </Card>

        {/* Tables */}
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent PQRs</CardTitle></CardHeader>
            <CardContent>
              {data?.recentPqrs?.length ? (
                <ResponsiveDataTable
                  columns={recentColumns}
                  data={data.recentPqrs}
                  searchKeys={['pqrNumber', 'product', 'preparedBy', 'productCode']}
                  mobileTitleKey="pqrNumber"
                  mobileSubtitleKey="product"
                  pageSize={10}
                />
              ) : (
                <EmptyState title="No PQR records" message="Create a PQR to begin annual product quality review." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">PQRs Due / Overdue</CardTitle></CardHeader>
            <CardContent>
              {data?.duePqrs?.length ? (
                <ResponsiveDataTable
                  columns={dueColumns}
                  data={data.duePqrs}
                  searchKeys={['product', 'owner']}
                  mobileTitleKey="product"
                  mobileSubtitleKey="dueDate"
                  pageSize={10}
                />
              ) : (
                <EmptyState title="No overdue PQRs" message="All annual reviews are on schedule." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Pending Approvals</CardTitle></CardHeader>
            <CardContent>
              {data?.pendingApprovals?.length ? (
                <ResponsiveDataTable
                  columns={approvalColumns}
                  data={data.pendingApprovals}
                  searchKeys={['pqrNumber', 'product', 'pendingWith']}
                  mobileTitleKey="pqrNumber"
                  mobileSubtitleKey="product"
                  pageSize={10}
                />
              ) : (
                <EmptyState title="No pending approvals" message="All PQR approval steps are complete." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Critical Quality Alerts</CardTitle></CardHeader>
            <CardContent>
              {data?.criticalAlerts?.length ? (
                <ResponsiveDataTable
                  columns={alertColumns}
                  data={data.criticalAlerts}
                  searchKeys={['product', 'batchNo', 'issue']}
                  mobileTitleKey="product"
                  mobileSubtitleKey="issue"
                  pageSize={10}
                />
              ) : (
                <EmptyState title="No critical alerts" message="No open OOS, deviation, CAPA, or recall alerts." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Action Items</CardTitle></CardHeader>
            <CardContent>
              {data?.actionItems?.length ? (
                <ResponsiveDataTable
                  columns={actionColumns}
                  data={data.actionItems}
                  searchKeys={['description', 'owner', 'source']}
                  mobileTitleKey="description"
                  mobileSubtitleKey="owner"
                  pageSize={10}
                />
              ) : (
                <EmptyState title="No open actions" message="Pending reviews, approvals, CAPA, and deviations will appear here." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Findings & Recurring Issues</CardTitle></CardHeader>
            <CardContent>
              {data?.findings?.length ? (
                <ResponsiveDataTable
                  columns={findingColumns}
                  data={data.findings}
                  searchKeys={['description', 'product', 'category']}
                  mobileTitleKey="description"
                  mobileSubtitleKey="category"
                  pageSize={10}
                />
              ) : (
                <EmptyState title="No findings" message="Critical and recurring quality findings will appear here." />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Activity + Notifications */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
            <CardContent>
              <ActivityTimeline entries={data?.activity || []} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">PQR Notifications</CardTitle>
              <Link href="/notifications" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                <Bell className="h-4 w-4" />View all
              </Link>
            </CardHeader>
            <CardContent>
              {pqrNotifications.length ? (
                <ul className="space-y-3">
                  {pqrNotifications.map((n) => (
                    <li key={n.id} className="rounded-md border p-3 text-sm">
                      <p className="font-medium">{n.title}</p>
                      <p className="text-muted-foreground line-clamp-2">{n.message}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No PQR notifications" message="Workflow alerts will appear here." />
              )}
            </CardContent>
          </Card>
        </div>

        {data?.generatedAt && (
          <p className="text-xs text-muted-foreground text-right">
            Last updated: {new Date(data.generatedAt).toLocaleString()}
            {error ? ` · Warning: ${error}` : ''}
          </p>
        )}
      </div>
    </PqrDashboardAccessGuard>
  );
}
