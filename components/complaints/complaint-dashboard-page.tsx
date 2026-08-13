'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Download, Eye, FileText, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  KPI_FILTER_MAP,
  canExportComplaintDashboard,
  getComplaintDaysOverdue,
  getCriticalComplaints,
  getOverdueComplaints,
  getRecentComplaints,
  isComplaintCapaLinked,
  isComplaintDashboardReadOnly,
} from '@/lib/complaint-dashboard-records';
import {
  exportComplaintDashboardCsvDownload,
  fetchComplaintDashboardData,
  logComplaintDashboardExcelExport,
  logComplaintDashboardFilterApplied,
  logComplaintDashboardPdfExport,
  logComplaintDashboardRefreshed,
  logComplaintDashboardViewed,
  logComplaintRecordOpened,
  openComplaintDashboardPdfPlaceholder,
} from '@/lib/complaint-dashboard-service';
import type { ComplaintDashboardMetrics, ComplaintFilters, ComplaintRecord } from '@/lib/complaint-types';
import { canCreateComplaint } from '@/lib/complaint-types';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ComplaintDashboardCharts } from './complaint-dashboard-charts';
import { ComplaintFiltersBar } from './complaint-filters';
import { ComplaintDashboardAccessGuard } from './complaint-dashboard-access-guard';
import { ComplaintStatusBadge, CriticalityBadge, RiskBadge } from './complaint-sub-nav';
import { DeviationTimeline } from '@/components/deviations/deviation-pdf-document';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

const KPI_ITEMS: {
  label: string;
  key: keyof ComplaintDashboardMetrics;
  filterKey?: string;
  tone?: 'blue' | 'green' | 'amber' | 'red';
}[] = [
  { label: 'Total Complaints', key: 'total', filterKey: 'total' },
  { label: 'Open Complaints', key: 'open', filterKey: 'open', tone: 'amber' },
  { label: 'Closed Complaints', key: 'closed', filterKey: 'closed', tone: 'green' },
  { label: 'Critical Complaints', key: 'critical', filterKey: 'critical', tone: 'red' },
  { label: 'Major Complaints', key: 'major', filterKey: 'major', tone: 'amber' },
  { label: 'Minor Complaints', key: 'minor', filterKey: 'minor', tone: 'green' },
  { label: 'Under Investigation', key: 'underInvestigation', filterKey: 'under_investigation', tone: 'blue' },
  { label: 'CAPA Required', key: 'capaRequired', filterKey: 'capa_required', tone: 'amber' },
  { label: 'CAPA Linked', key: 'capaLinked', filterKey: 'capa_linked', tone: 'blue' },
  { label: 'Recall Evaluation Required', key: 'recallEvaluationRequired', filterKey: 'recall_evaluation', tone: 'red' },
  { label: 'Overdue Complaints', key: 'overdue', filterKey: 'overdue', tone: 'red' },
  { label: 'Product Quality Impact', key: 'productQualityImpact', filterKey: 'product_quality_impact', tone: 'amber' },
  { label: 'Market Impact', key: 'marketImpact', filterKey: 'market_impact', tone: 'amber' },
  { label: 'Repeat Complaints', key: 'repeatComplaints', filterKey: 'repeat', tone: 'red' },
];

function yesNo(value: unknown): string {
  if (value === true) return 'Yes';
  if (typeof value === 'string' && value.toLowerCase() === 'yes') return 'Yes';
  return 'No';
}

export function ComplaintDashboardPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={3} />}>
      <ComplaintDashboardContent />
    </Suspense>
  );
}

function ComplaintDashboardContent() {
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canExport = canExportComplaintDashboard(role);
  const readOnly = isComplaintDashboardReadOnly(role);
  const canCreate = role ? canCreateComplaint(role) : false;
  const viewedLogged = useRef(false);

  const [filters, setFilters] = useState<ComplaintFilters>({});
  const [records, setRecords] = useState<ComplaintRecord[]>([]);
  const [metrics, setMetrics] = useState<ComplaintDashboardMetrics | null>(null);
  const [charts, setCharts] = useState<import('@/lib/complaint-types').ComplaintDashboardChartData | null>(null);
  const [activity, setActivity] = useState<import('@/lib/complaint-types').ComplaintActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeKpi, setActiveKpi] = useState<string | null>(null);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || 'System',
    role: role || '',
    department: profile?.department || '',
  }), [user?.uid, profile?.full_name, profile?.department, role]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await fetchComplaintDashboardData(filters, actor);
      setRecords(data.records);
      setMetrics(data.metrics);
      setCharts(data.charts);
      setActivity(data.activity);
      if (isRefresh) {
        await logComplaintDashboardRefreshed(actor, data.records.length);
        toast.success('Dashboard refreshed');
      }
    } catch {
      setError('Failed to load complaint dashboard data.');
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters, actor]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!viewedLogged.current && !loading) {
      viewedLogged.current = true;
      void logComplaintDashboardViewed(actor);
    }
  }, [loading, actor]);

  useEffect(() => {
    const kpi = searchParams.get('kpi');
    if (kpi && KPI_FILTER_MAP[kpi]) {
      setActiveKpi(kpi);
      setFilters((prev) => ({ ...prev, ...KPI_FILTER_MAP[kpi], kpi_filter: kpi }));
    }
  }, [searchParams]);

  const handleFilterChange = (next: ComplaintFilters) => {
    setFilters(next);
    setActiveKpi(null);
    void logComplaintDashboardFilterApplied(actor, next);
  };

  const handleKpiClick = (filterKey?: string) => {
    if (!filterKey) return;
    const next = KPI_FILTER_MAP[filterKey] || {};
    const isActive = activeKpi === filterKey;
    if (isActive) {
      setActiveKpi(null);
      setFilters((prev) => ({ ...prev, kpi_filter: undefined }));
    } else {
      setActiveKpi(filterKey);
      setFilters((prev) => ({ ...prev, ...next, kpi_filter: filterKey }));
    }
  };

  const handleExportPdf = async () => {
    if (!canExport) return toast.error('No export permission');
    try {
      openComplaintDashboardPdfPlaceholder(records, actor.name);
      await logComplaintDashboardPdfExport(actor, records.length);
      toast.success('PDF export completed');
    } catch (e) {
      await logComplaintDashboardPdfExport(actor, records.length);
      toast.error(e instanceof Error ? e.message : 'Complaint dashboard PDF export is not available.');
    }
  };

  const handleExportExcel = async () => {
    if (!canExport) return toast.error('No export permission');
    exportComplaintDashboardCsvDownload(records, `complaint-dashboard-${Date.now()}.csv`);
    await logComplaintDashboardExcelExport(actor, records.length);
    toast.success('Excel export downloaded (audit logged)');
  };

  const recentComplaints = useMemo(() => getRecentComplaints(records, 10), [records]);
  const overdueComplaints = useMemo(() => getOverdueComplaints(records).slice(0, 10), [records]);
  const criticalComplaints = useMemo(() => getCriticalComplaints(records).slice(0, 10), [records]);

  const viewLink = useCallback((r: ComplaintRecord) => (
    <Link
      href={`/qms/complaints/${r.id}`}
      onClick={() => void logComplaintRecordOpened(actor, r.id, r.complaint_number)}
    >
      <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
    </Link>
  ), [actor]);

  const recentColumns = useMemo(() => [
    { key: 'complaint_number', header: 'Complaint No', render: (r: ComplaintRecord) => <span className="font-mono text-blue-600">{r.complaint_number}</span> },
    { key: 'complaint_date', header: 'Complaint Date' },
    { key: 'customer', header: 'Customer / Market', render: (r: ComplaintRecord) => `${r.customer_name || '—'} / ${r.market_region || '—'}` },
    { key: 'product_name', header: 'Product', render: (r: ComplaintRecord) => <span className="truncate max-w-[140px] block">{r.product_name || '—'}</span> },
    { key: 'batch_number', header: 'Batch No' },
    { key: 'complaint_category', header: 'Category' },
    { key: 'criticality', header: 'Criticality', render: (r: ComplaintRecord) => <CriticalityBadge value={r.complaint_criticality} /> },
    { key: 'status', header: 'Status', render: (r: ComplaintRecord) => <ComplaintStatusBadge status={r.status} /> },
    { key: 'assigned', header: 'Assigned To', render: (r: ComplaintRecord) => r.assigned_to_name || r.assigned_to || '—' },
    { key: 'due_date', header: 'Due Date', render: (r: ComplaintRecord) => r.due_date || '—' },
    { key: 'actions', header: 'Action', render: (r: ComplaintRecord) => viewLink(r) },
  ], [viewLink]);

  const overdueColumns = useMemo(() => [
    { key: 'complaint_number', header: 'Complaint No', render: (r: ComplaintRecord) => <span className="font-mono text-red-600">{r.complaint_number}</span> },
    { key: 'product_name', header: 'Product' },
    { key: 'batch_number', header: 'Batch No' },
    { key: 'due_date', header: 'Due Date', render: (r: ComplaintRecord) => r.due_date || r.complaint_date || '—' },
    { key: 'days', header: 'Days Overdue', render: (r: ComplaintRecord) => getComplaintDaysOverdue(r) },
    { key: 'assigned', header: 'Assigned To', render: (r: ComplaintRecord) => r.assigned_to_name || r.assigned_to || '—' },
    { key: 'status', header: 'Status', render: (r: ComplaintRecord) => <ComplaintStatusBadge status={r.status} /> },
    { key: 'actions', header: 'Action', render: (r: ComplaintRecord) => viewLink(r) },
  ], [viewLink]);

  const criticalColumns = useMemo(() => [
    { key: 'complaint_number', header: 'Complaint No', render: (r: ComplaintRecord) => <span className="font-mono text-red-600">{r.complaint_number}</span> },
    { key: 'product_name', header: 'Product' },
    { key: 'batch_number', header: 'Batch No' },
    { key: 'issue', header: 'Issue', render: (r: ComplaintRecord) => <span className="truncate max-w-[160px] block">{r.complaint_description || '—'}</span> },
    { key: 'risk', header: 'Risk Level', render: (r: ComplaintRecord) => <RiskBadge level={r.risk_level || r.complaint_criticality} /> },
    { key: 'recall', header: 'Recall Required', render: (r: ComplaintRecord) => yesNo(r.recall_required) },
    { key: 'capa', header: 'CAPA Required', render: (r: ComplaintRecord) => yesNo(r.capa_required || isComplaintCapaLinked(r)) },
    { key: 'status', header: 'Status', render: (r: ComplaintRecord) => <ComplaintStatusBadge status={r.status} /> },
    { key: 'actions', header: 'Action', render: (r: ComplaintRecord) => viewLink(r) },
  ], [viewLink]);

  return (
    <ComplaintDashboardAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Complaint Dashboard"
          description="Monitor market complaints, investigations, CAPA linkage and recall evaluation"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/complaints' },
            { label: 'Complaint Management', href: '/qms/complaints' },
            { label: 'Dashboard' },
          ]}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
                <RefreshCw className={cn('mr-1 h-4 w-4', refreshing && 'animate-spin')} /> Refresh
              </Button>
              {canExport && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handleExportPdf()}>
                    <FileText className="mr-1 h-4 w-4" /> PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleExportExcel()}>
                    <Download className="mr-1 h-4 w-4" /> Excel
                  </Button>
                </>
              )}
              {canCreate && !readOnly && (
                <Link href="/qms/complaints/create">
                  <Button className="bg-blue-600 hover:bg-blue-700 gap-1" size="sm">
                    <Plus className="h-4 w-4" /> Register Complaint
                  </Button>
                </Link>
              )}
            </div>
          )}
        />

        <ComplaintFiltersBar filters={filters} onChange={handleFilterChange} />

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorCard title="Load error" message={error} />
        ) : (
          <>
            {metrics && (metrics.critical > 0 || metrics.overdue > 0) && (
              <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-900">
                <AlertTitle>Critical Alerts</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>
                    {metrics.critical > 0 && `${metrics.critical} critical complaint(s)`}
                    {metrics.critical > 0 && metrics.overdue > 0 && ' · '}
                    {metrics.overdue > 0 && `${metrics.overdue} overdue complaint(s) require attention`}
                    {metrics.recallEvaluationRequired > 0 && ` · ${metrics.recallEvaluationRequired} recall evaluation(s) pending`}
                  </span>
                  <Link href="/notifications" className="font-medium underline underline-offset-2">View notifications</Link>
                </AlertDescription>
              </Alert>
            )}

            {metrics && (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {KPI_ITEMS.map((item) => (
                  <div
                    key={item.key}
                    className={cn(activeKpi === item.filterKey && 'ring-2 ring-blue-500 rounded-lg')}
                  >
                    <button
                      type="button"
                      className={cn('w-full text-left', item.filterKey && 'cursor-pointer')}
                      onClick={() => item.filterKey && handleKpiClick(item.filterKey)}
                    >
                      <KpiCard
                        label={item.label}
                        value={metrics[item.key] ?? 0}
                        tone={item.tone}
                      />
                    </button>
                  </div>
                ))}
                <KpiCard label="Avg Closure Days" value={metrics.avgClosureDays} tone="blue" />
              </div>
            )}

            {charts && <ComplaintDashboardCharts charts={charts} />}

            <Tabs defaultValue="recent">
              <TabsList className="flex h-auto flex-wrap gap-1">
                <TabsTrigger value="recent">Recent Complaints</TabsTrigger>
                <TabsTrigger value="overdue">Overdue ({overdueComplaints.length})</TabsTrigger>
                <TabsTrigger value="critical">Critical ({criticalComplaints.length})</TabsTrigger>
                <TabsTrigger value="activity">Activity Timeline</TabsTrigger>
              </TabsList>

              <TabsContent value="recent" className="mt-4">
                {recentComplaints.length ? (
                  <ResponsiveDataTable
                    columns={recentColumns}
                    data={recentComplaints}
                    mobileTitleKey="complaint_number"
                    mobileSubtitleKey="product_name"
                    pageSize={8}
                  />
                ) : (
                  <EmptyState title="No complaints" message="Register a complaint or adjust filters to see records." />
                )}
              </TabsContent>

              <TabsContent value="overdue" className="mt-4">
                {overdueComplaints.length ? (
                  <ResponsiveDataTable
                    columns={overdueColumns}
                    data={overdueComplaints}
                    mobileTitleKey="complaint_number"
                    mobileSubtitleKey="product_name"
                    pageSize={8}
                  />
                ) : (
                  <EmptyState title="No overdue complaints" message="All complaints are within due dates." />
                )}
              </TabsContent>

              <TabsContent value="critical" className="mt-4">
                {criticalComplaints.length ? (
                  <ResponsiveDataTable
                    columns={criticalColumns}
                    data={criticalComplaints}
                    mobileTitleKey="complaint_number"
                    mobileSubtitleKey="product_name"
                    pageSize={8}
                  />
                ) : (
                  <EmptyState title="No critical complaints" message="No open critical complaints in the current scope." />
                )}
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
                  <CardContent>
                    {activity.length ? (
                      <DeviationTimeline events={activity.map((a) => ({
                        date: a.date,
                        title: a.title,
                        description: a.description,
                        user: a.user,
                      }))} />
                    ) : (
                      <EmptyState title="No recent activity" message="Complaint activity will appear here as actions are performed." />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {metrics && (
              <p className="text-xs text-muted-foreground text-center">
                Showing {records.length} filtered record(s) · Avg closure: {metrics.avgClosureDays} days
                {readOnly && ' · Read-only access'}
                {metrics.recallEvaluationRequired > 0 && ` · ${metrics.recallEvaluationRequired} recall evaluation(s) pending`}
              </p>
            )}
          </>
        )}
      </div>
    </ComplaintDashboardAccessGuard>
  );
}
