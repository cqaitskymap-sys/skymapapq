'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Download, Eye, FileText, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  KPI_FILTER_MAP,
  canExportOosDashboard,
  isOosDashboardReadOnly,
} from '@/lib/oos-dashboard-records';
import {
  exportOosDashboardCsv,
  fetchOosDashboardData,
  logOosDashboardExcelExport,
  logOosDashboardFilterApplied,
  logOosDashboardPdfExport,
  logOosDashboardRefreshed,
  logOosDashboardViewed,
  logOosRecordOpened,
  openOosDashboardPdfPlaceholder,
} from '@/lib/oos-dashboard-service';
import { getDaysOverdueOos, getOosRiskLevel, type OosFilters, type OosRecord } from '@/lib/oos-types';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { OosDashboardCharts } from './oos-dashboard-charts';
import { OosFiltersBar } from './oos-filters';
import { OosDashboardAccessGuard } from './oos-dashboard-access-guard';
import { OosStatusBadge, ResultStatusBadge, RiskBadge } from './oos-sub-nav';
import { DeviationTimeline } from '@/components/deviations/deviation-pdf-document';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type { OosDashboardMetrics } from '@/lib/oos-types';

const KPI_ITEMS: { label: string; key: keyof OosDashboardMetrics; tone?: 'blue' | 'green' | 'amber' | 'red' }[] = [
  { label: 'Total OOS', key: 'total' },
  { label: 'Open OOS', key: 'open', tone: 'amber' },
  { label: 'Closed OOS', key: 'closed', tone: 'green' },
  { label: 'Draft OOS', key: 'draft' },
  { label: 'Phase-I Investigation', key: 'phase1', tone: 'amber' },
  { label: 'Phase-II Investigation', key: 'phase2', tone: 'amber' },
  { label: 'QA Review Pending', key: 'qaReviewPending', tone: 'blue' },
  { label: 'CAPA Required', key: 'capaRequired', tone: 'red' },
  { label: 'CAPA Linked', key: 'capaLinked', tone: 'blue' },
  { label: 'Overdue OOS', key: 'overdue', tone: 'red' },
  { label: 'Critical OOS', key: 'critical', tone: 'red' },
  { label: 'Laboratory Error OOS', key: 'laboratoryError', tone: 'amber' },
  { label: 'Manufacturing Related OOS', key: 'manufacturingRelated', tone: 'amber' },
  { label: 'Inconclusive OOS', key: 'inconclusive' },
  { label: 'Batch Blocked OOS', key: 'batchBlocked', tone: 'red' },
  { label: 'Product Quality Impact OOS', key: 'productQualityImpact', tone: 'red' },
];

export function OosDashboardPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={3} />}>
      <OosDashboardContent />
    </Suspense>
  );
}

function OosDashboardContent() {
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canExport = canExportOosDashboard(role);
  const readOnly = isOosDashboardReadOnly(role);
  const viewedLogged = useRef(false);

  const initialFilters = useMemo<OosFilters>(() => ({
    status: searchParams.get('status') || undefined,
    capa_linked: searchParams.get('capa_linked') === 'true' ? true : undefined,
  }), [searchParams]);

  const [filters, setFilters] = useState<OosFilters>(initialFilters);
  const [records, setRecords] = useState<OosRecord[]>([]);
  const [metrics, setMetrics] = useState<OosDashboardMetrics | null>(null);
  const [impactMap, setImpactMap] = useState<Map<string, import('@/lib/oos-types').OosImpactAssessment>>(new Map());
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
      const data = await fetchOosDashboardData(filters);
      setRecords(data.records);
      setMetrics(data.metrics);
      setImpactMap(data.impactMap);
      if (isRefresh) {
        await logOosDashboardRefreshed(actor, data.records.length);
        toast.success('Dashboard refreshed');
      }
    } catch {
      setError('Failed to load OOS dashboard data.');
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
      void logOosDashboardViewed(actor);
    }
  }, [loading, actor]);

  const handleFilterChange = (next: OosFilters) => {
    if (!next.kpi_filter) setActiveKpi(null);
    setFilters(next);
    void logOosDashboardFilterApplied(actor, next);
  };

  const handleKpiClick = (label: string) => {
    const kpiKey = KPI_FILTER_MAP[label];
    if (!kpiKey || kpiKey === 'all') {
      setActiveKpi(null);
      handleFilterChange({ ...filters, kpi_filter: undefined });
      return;
    }
    setActiveKpi(label);
    handleFilterChange({ ...filters, kpi_filter: kpiKey });
  };

  const handleExportPdf = async () => {
    if (!canExport) return toast.error('No export permission');
    try {
      openOosDashboardPdfPlaceholder(actor.name, records.length);
      await logOosDashboardPdfExport(actor, records.length);
      toast.success('PDF export completed');
    } catch (e) {
      await logOosDashboardPdfExport(actor, records.length);
      toast.error(e instanceof Error ? e.message : 'OOS dashboard PDF export is not available.');
    }
  };

  const handleExportExcel = async () => {
    if (!canExport) return toast.error('No export permission');
    exportOosDashboardCsv(records);
    await logOosDashboardExcelExport(actor, records.length);
    toast.success('Excel export downloaded');
  };

  const recentOos = records.slice(0, 15);
  const overdueOos = records.filter((r) => r.status === 'overdue' || getDaysOverdueOos(r) > 0).slice(0, 10);
  const criticalOos = records.filter((r) =>
    r.is_critical_test || ['Sterility', 'Endotoxin', 'Assay'].some((t) => (r.test_name || '').toLowerCase().includes(t.toLowerCase())),
  ).slice(0, 10);

  const recentColumns = [
    { key: 'oos_number', header: 'OOS No', render: (r: OosRecord) => <span className="font-mono text-blue-600">{r.oos_number}</span> },
    { key: 'oos_date', header: 'Date' },
    { key: 'department', header: 'Department' },
    { key: 'product_name', header: 'Product' },
    { key: 'batch_number', header: 'Batch No' },
    { key: 'test_name', header: 'Test Name' },
    { key: 'observed', header: 'Observed', render: (r: OosRecord) => `${r.obtained_result || r.observed_result} ${r.unit || ''}`.trim() },
    { key: 'spec', header: 'Specification', render: (r: OosRecord) => r.specification || `${r.spec_lower_limit}-${r.spec_upper_limit}` },
    { key: 'status', header: 'Status', render: (r: OosRecord) => <OosStatusBadge status={r.status} /> },
    { key: 'assigned', header: 'Assigned To', render: (r: OosRecord) => r.assigned_to_name || '—' },
    { key: 'due', header: 'Due Date', render: (r: OosRecord) => r.target_closure_date || '—' },
    {
      key: 'action',
      header: 'Action',
      render: (r: OosRecord) => (
        <Link href={`/qms/oos/${r.id}`} onClick={() => void logOosRecordOpened(actor, r.id, r.oos_number)}>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><Eye className="h-4 w-4" /></Button>
        </Link>
      ),
    },
  ];

  const overdueColumns = [
    { key: 'oos_number', header: 'OOS No', render: (r: OosRecord) => <span className="font-mono text-red-600">{r.oos_number}</span> },
    { key: 'product_name', header: 'Product' },
    { key: 'batch_number', header: 'Batch No' },
    { key: 'target', header: 'Target Closure', render: (r: OosRecord) => r.target_closure_date || '—' },
    { key: 'days', header: 'Days Overdue', render: (r: OosRecord) => getDaysOverdueOos(r) },
    { key: 'assigned', header: 'Assigned To', render: (r: OosRecord) => r.assigned_to_name || '—' },
    { key: 'status', header: 'Status', render: (r: OosRecord) => <OosStatusBadge status={r.status} /> },
    {
      key: 'action',
      header: 'Action',
      render: (r: OosRecord) => (
        <Link href={`/qms/oos/${r.id}`}><Button variant="outline" size="sm">Open</Button></Link>
      ),
    },
  ];

  const criticalColumns = [
    { key: 'oos_number', header: 'OOS No', render: (r: OosRecord) => <span className="font-mono text-red-600">{r.oos_number}</span> },
    { key: 'product_name', header: 'Product' },
    { key: 'batch_number', header: 'Batch No' },
    { key: 'test_name', header: 'Test Name' },
    { key: 'impact', header: 'Impact', render: (r: OosRecord) => <ResultStatusBadge status={r.result_status} /> },
    { key: 'risk', header: 'Risk Level', render: (r: OosRecord) => <RiskBadge level={getOosRiskLevel(r, impactMap.get(r.id))} /> },
    { key: 'capa', header: 'CAPA Required', render: (r: OosRecord) => r.capa_required ? 'Yes' : 'No' },
    { key: 'status', header: 'Status', render: (r: OosRecord) => <OosStatusBadge status={r.status} /> },
    {
      key: 'action',
      header: 'Action',
      render: (r: OosRecord) => (
        <Link href={`/qms/oos/${r.id}`}><Button variant="outline" size="sm">Review</Button></Link>
      ),
    },
  ];

  return (
    <OosDashboardAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="OOS Dashboard"
          description="Monitor Out of Specification investigations, quality impact and closure performance"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/oos' },
            { label: 'OOS Management', href: '/qms/oos' },
            { label: 'Dashboard' },
          ]}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
                <RefreshCw className={cn('mr-1 h-4 w-4', refreshing && 'animate-spin')} /> Refresh
              </Button>
              {canExport && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handleExportPdf()}><FileText className="mr-1 h-4 w-4" /> PDF</Button>
                  <Button variant="outline" size="sm" onClick={() => void handleExportExcel()}><Download className="mr-1 h-4 w-4" /> Excel</Button>
                </>
              )}
              {!readOnly && (
                <Link href="/qms/oos/create"><Button size="sm" className="bg-blue-600 hover:bg-blue-700"><Plus className="mr-1 h-4 w-4" /> Create OOS</Button></Link>
              )}
            </div>
          )}
        />

        {loading ? <LoadingSkeleton rows={4} /> : error ? (
          <ErrorCard title="Load error" message={error} onRetry={() => void load(true)} />
        ) : (
          <>
            {metrics && metrics.overdue > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Critical Alerts</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>{metrics.overdue} overdue OOS investigation(s) require immediate attention. {metrics.batchBlocked} batch(es) blocked.</span>
                  <Link href="/notifications" className="font-medium underline underline-offset-2">View notifications</Link>
                </AlertDescription>
              </Alert>
            )}

            {metrics && (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8 gap-3">
                {KPI_ITEMS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={cn('text-left rounded-lg transition-shadow', activeKpi === item.label && 'ring-2 ring-blue-500')}
                    onClick={() => handleKpiClick(item.label)}
                  >
                    <KpiCard label={item.label} value={metrics[item.key] as number} tone={item.tone} />
                  </button>
                ))}
                <KpiCard label="Avg Closure Days" value={metrics.avgClosureDays} tone="blue" />
              </div>
            )}

            <OosFiltersBar filters={filters} onChange={handleFilterChange} />

            {metrics && <OosDashboardCharts metrics={metrics} />}

            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Recent OOS</CardTitle></CardHeader>
                <CardContent>
                  {recentOos.length ? (
                    <ResponsiveDataTable columns={recentColumns} data={recentOos} mobileTitleKey="oos_number" mobileSubtitleKey="product_name" pageSize={8} />
                  ) : (
                    <EmptyState title="No OOS records" message="Create an OOS record or adjust filters to see data." />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Overdue OOS</CardTitle></CardHeader>
                <CardContent>
                  {overdueOos.length ? (
                    <ResponsiveDataTable columns={overdueColumns} data={overdueOos} mobileTitleKey="oos_number" mobileSubtitleKey="product_name" pageSize={8} />
                  ) : (
                    <EmptyState title="No overdue OOS" message="All investigations are within target closure dates." />
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Critical OOS</CardTitle></CardHeader>
              <CardContent>
                {criticalOos.length ? (
                  <ResponsiveDataTable columns={criticalColumns} data={criticalOos} mobileTitleKey="oos_number" mobileSubtitleKey="test_name" pageSize={8} />
                ) : (
                  <EmptyState title="No critical OOS" message="No critical tests currently flagged as OOS." />
                )}
              </CardContent>
            </Card>

            {metrics?.recentActivity?.length ? (
              <Card>
                <CardHeader><CardTitle className="text-base">Recent Activity Timeline</CardTitle></CardHeader>
                <CardContent>
                  <DeviationTimeline events={metrics.recentActivity.map((a) => ({
                    date: a.date,
                    title: a.title,
                    description: a.description,
                    user: a.user,
                  }))} />
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </OosDashboardAccessGuard>
  );
}
