'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Download, Eye, FileText, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  KPI_FILTER_MAP,
  canExportCapaDashboard,
  getEffectivenessPendingCapas,
  getOverdueCapas,
  getRecentCapas,
  getCapaDaysOverdue,
  isCapaDashboardReadOnly,
} from '@/lib/capa-dashboard-records';
import {
  exportCapaDashboardCsvDownload,
  fetchCapaDashboardData,
  logCapaDashboardExcelExport,
  logCapaDashboardFilterApplied,
  logCapaDashboardPdfExport,
  logCapaDashboardRefreshed,
  logCapaDashboardViewed,
  logCapaRecordOpened,
  openCapaDashboardPdfPlaceholder,
} from '@/lib/capa-dashboard-service';
import { getLatestCapaTrendSummary } from '@/lib/capa-trend-service';
import type { CapaDashboardMetrics, CapaFilters, CapaRecord } from '@/lib/capa-types';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { CapaDashboardCharts } from './capa-dashboard-charts';
import { CapaFiltersBar } from './capa-filters';
import { CapaDashboardAccessGuard } from './capa-dashboard-access-guard';
import { CapaStatusBadge, CapaPriorityBadge } from './capa-sub-nav';
import { DeviationTimeline } from '@/components/deviations/deviation-pdf-document';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const KPI_ITEMS: { label: string; key: keyof CapaDashboardMetrics; filterKey?: string; tone?: 'blue' | 'green' | 'amber' | 'red' }[] = [
  { label: 'Total CAPA', key: 'total', filterKey: 'total' },
  { label: 'Open CAPA', key: 'open', filterKey: 'open', tone: 'amber' },
  { label: 'Closed CAPA', key: 'closed', filterKey: 'closed', tone: 'green' },
  { label: 'Draft CAPA', key: 'draft', filterKey: 'draft' },
  { label: 'Under Implementation', key: 'underImplementation', filterKey: 'under_implementation', tone: 'amber' },
  { label: 'Effectiveness Pending', key: 'effectivenessPending', filterKey: 'effectiveness_pending', tone: 'blue' },
  { label: 'Overdue CAPA', key: 'overdue', filterKey: 'overdue', tone: 'red' },
  { label: 'Critical CAPA', key: 'critical', filterKey: 'critical', tone: 'red' },
  { label: 'High Priority CAPA', key: 'highPriority', filterKey: 'high_priority', tone: 'amber' },
  { label: 'Effective CAPA', key: 'effective', filterKey: 'effective', tone: 'green' },
  { label: 'Not Effective CAPA', key: 'notEffective', filterKey: 'not_effective', tone: 'red' },
  { label: 'CAPA Due This Week', key: 'dueThisWeek', filterKey: 'due_this_week', tone: 'amber' },
  { label: 'Deviation Linked', key: 'deviationLinked', filterKey: 'deviation_linked', tone: 'blue' },
  { label: 'OOS Linked', key: 'oosLinked', filterKey: 'oos_linked', tone: 'blue' },
  { label: 'Audit Linked', key: 'auditLinked', filterKey: 'audit_linked', tone: 'blue' },
];

export function CapaDashboardPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={3} />}>
      <CapaDashboardContent />
    </Suspense>
  );
}

function CapaDashboardContent() {
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canExport = canExportCapaDashboard(role);
  const readOnly = isCapaDashboardReadOnly(role);
  const viewedLogged = useRef(false);

  const [filters, setFilters] = useState<CapaFilters>({});
  const [records, setRecords] = useState<CapaRecord[]>([]);
  const [metrics, setMetrics] = useState<CapaDashboardMetrics | null>(null);
  const [charts, setCharts] = useState<import('@/lib/capa-dashboard-records').CapaDashboardChartData | null>(null);
  const [activity, setActivity] = useState<import('@/lib/capa-types').CapaActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeKpi, setActiveKpi] = useState<string | null>(null);
  const [trendSummary, setTrendSummary] = useState<string | null>(null);

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
      const data = await fetchCapaDashboardData(filters, actor);
      setRecords(data.records);
      setMetrics(data.metrics);
      setCharts(data.charts);
      setActivity(data.activity);
      setTrendSummary(await getLatestCapaTrendSummary());
      if (isRefresh) {
        await logCapaDashboardRefreshed(actor, data.records.length);
        toast.success('Dashboard refreshed');
      }
    } catch {
      setError('Failed to load CAPA dashboard data.');
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
      void logCapaDashboardViewed(actor);
    }
  }, [loading, actor]);

  useEffect(() => {
    const kpi = searchParams.get('kpi');
    if (kpi && KPI_FILTER_MAP[kpi]) {
      setActiveKpi(kpi);
      setFilters((prev) => ({ ...prev, ...KPI_FILTER_MAP[kpi], kpi_filter: kpi }));
    }
  }, [searchParams]);

  const handleFilterChange = (next: CapaFilters) => {
    setFilters(next);
    setActiveKpi(null);
    void logCapaDashboardFilterApplied(actor, next);
  };

  const handleKpiClick = (filterKey?: string) => {
    if (!filterKey) return;
    const next = KPI_FILTER_MAP[filterKey] || {};
    const isActive = activeKpi === filterKey;
    if (isActive) {
      setActiveKpi(null);
      setFilters((prev) => ({ ...prev, kpi_filter: undefined, overdue_only: undefined }));
    } else {
      setActiveKpi(filterKey);
      setFilters((prev) => ({ ...prev, ...next, kpi_filter: filterKey }));
    }
  };

  const handleExportPdf = async () => {
    if (!canExport) return toast.error('No export permission');
    try {
      openCapaDashboardPdfPlaceholder(records, actor.name);
      await logCapaDashboardPdfExport(actor, records.length);
      toast.success('PDF export completed');
    } catch (e) {
      await logCapaDashboardPdfExport(actor, records.length);
      toast.error(e instanceof Error ? e.message : 'CAPA dashboard PDF export is not available.');
    }
  };

  const handleExportExcel = async () => {
    if (!canExport) return toast.error('No export permission');
    exportCapaDashboardCsvDownload(records, `capa-dashboard-${Date.now()}.csv`);
    await logCapaDashboardExcelExport(actor, records.length);
    toast.success('Excel export downloaded (audit logged)');
  };

  const recentCapas = useMemo(() => getRecentCapas(records, 10), [records]);
  const overdueCapas = useMemo(() => getOverdueCapas(records).slice(0, 10), [records]);
  const effectivenessPending = useMemo(() => getEffectivenessPendingCapas(records).slice(0, 10), [records]);

  const viewLink = useCallback((r: CapaRecord) => (
    <Link href={`/qms/capa/${r.id}`} onClick={() => void logCapaRecordOpened(actor, r.id, r.capa_number)}>
      <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
    </Link>
  ), [actor]);

  const recentColumns = useMemo(() => [
    { key: 'capa_number', header: 'CAPA No', render: (r: CapaRecord) => <span className="font-mono text-blue-600">{r.capa_number}</span> },
    { key: 'capa_source', header: 'Source' },
    { key: 'department', header: 'Department' },
    { key: 'capa_title', header: 'Title', render: (r: CapaRecord) => <span className="truncate max-w-[180px] block">{r.capa_title}</span> },
    { key: 'owner', header: 'Owner', render: (r: CapaRecord) => r.action_owner_name || '—' },
    { key: 'due', header: 'Due Date', render: (r: CapaRecord) => r.target_completion_date || '—' },
    { key: 'status', header: 'Status', render: (r: CapaRecord) => <CapaStatusBadge status={r.capa_status} /> },
    { key: 'priority', header: 'Priority', render: (r: CapaRecord) => <CapaPriorityBadge priority={r.priority} /> },
    { key: 'actions', header: 'Action', render: (r: CapaRecord) => viewLink(r) },
  ], [viewLink]);

  const overdueColumns = useMemo(() => [
    { key: 'capa_number', header: 'CAPA No', render: (r: CapaRecord) => <span className="font-mono text-red-600">{r.capa_number}</span> },
    { key: 'owner', header: 'Owner', render: (r: CapaRecord) => r.action_owner_name || '—' },
    { key: 'department', header: 'Department' },
    { key: 'due', header: 'Due Date', render: (r: CapaRecord) => r.target_completion_date || '—' },
    { key: 'days', header: 'Days Overdue', render: (r: CapaRecord) => getCapaDaysOverdue(r) },
    { key: 'status', header: 'Status', render: (r: CapaRecord) => <CapaStatusBadge status={r.capa_status} /> },
    { key: 'actions', header: 'Action', render: (r: CapaRecord) => viewLink(r) },
  ], [viewLink]);

  const effColumns = useMemo(() => [
    { key: 'capa_number', header: 'CAPA No', render: (r: CapaRecord) => <span className="font-mono text-blue-600">{r.capa_number}</span> },
    { key: 'eff_date', header: 'Effectiveness Date', render: (r: CapaRecord) => r.effectiveness_check_date || '—' },
    { key: 'owner', header: 'Owner', render: (r: CapaRecord) => r.action_owner_name || '—' },
    { key: 'source', header: 'Source', render: (r: CapaRecord) => r.capa_source },
    { key: 'status', header: 'Status', render: (r: CapaRecord) => <CapaStatusBadge status={r.capa_status} /> },
    { key: 'actions', header: 'Action', render: (r: CapaRecord) => viewLink(r) },
  ], [viewLink]);

  return (
    <CapaDashboardAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="CAPA Dashboard"
          description="Monitor corrective and preventive actions, implementation and effectiveness"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/capa' },
            { label: 'CAPA Management', href: '/qms/capa' },
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
              {!readOnly && (
                <Link href="/qms/capa/create">
                  <Button className="bg-blue-600 hover:bg-blue-700 gap-1" size="sm">
                    <Plus className="h-4 w-4" /> Create CAPA
                  </Button>
                </Link>
              )}
            </div>
          )}
        />

        <CapaFiltersBar filters={filters} onChange={handleFilterChange} />

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorCard title="Load error" message={error} />
        ) : (
          <>
            {metrics && (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5">
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

            {charts && <CapaDashboardCharts charts={charts} />}

            {trendSummary && (
              <Card className="border-l-4 border-l-blue-600">
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                    CAPA Trend Analysis Summary
                  </CardTitle>
                  <Link href="/qms/capa/trend-analysis">
                    <Button variant="outline" size="sm">View Trend Analysis</Button>
                  </Link>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{trendSummary}</p>
                </CardContent>
              </Card>
            )}

            <Tabs defaultValue="recent">
              <TabsList className="flex h-auto flex-wrap gap-1">
                <TabsTrigger value="recent">Recent CAPA</TabsTrigger>
                <TabsTrigger value="overdue">Overdue CAPA ({overdueCapas.length})</TabsTrigger>
                <TabsTrigger value="effectiveness">Effectiveness Pending ({effectivenessPending.length})</TabsTrigger>
                <TabsTrigger value="activity">Activity Timeline</TabsTrigger>
              </TabsList>

              <TabsContent value="recent" className="mt-4">
                {recentCapas.length ? (
                  <ResponsiveDataTable
                    columns={recentColumns}
                    data={recentCapas}
                    mobileTitleKey="capa_number"
                    mobileSubtitleKey="capa_title"
                    pageSize={8}
                  />
                ) : (
                  <EmptyState title="No CAPA records" message="Create a CAPA or adjust filters to see records." />
                )}
              </TabsContent>

              <TabsContent value="overdue" className="mt-4">
                {overdueCapas.length ? (
                  <ResponsiveDataTable
                    columns={overdueColumns}
                    data={overdueCapas}
                    mobileTitleKey="capa_number"
                    mobileSubtitleKey="department"
                    pageSize={8}
                  />
                ) : (
                  <EmptyState title="No overdue CAPA" message="All CAPA actions are within target completion dates." />
                )}
              </TabsContent>

              <TabsContent value="effectiveness" className="mt-4">
                {effectivenessPending.length ? (
                  <ResponsiveDataTable
                    columns={effColumns}
                    data={effectivenessPending}
                    mobileTitleKey="capa_number"
                    mobileSubtitleKey="capa_source"
                    pageSize={8}
                  />
                ) : (
                  <EmptyState title="No effectiveness pending" message="No CAPA awaiting effectiveness verification." />
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
                      <EmptyState title="No recent activity" message="CAPA activity will appear here as actions are performed." />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {metrics && (
              <p className="text-xs text-muted-foreground text-center">
                Showing {records.length} filtered record(s) · Avg closure: {metrics.avgClosureDays} days
                {readOnly && ' · Read-only access'}
              </p>
            )}
          </>
        )}
      </div>
    </CapaDashboardAccessGuard>
  );
}
