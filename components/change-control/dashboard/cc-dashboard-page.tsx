'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, Clock, Database, FileSpreadsheet, FileText,
  FlaskConical, GraduationCap, Link2, Plus, RefreshCw, Scale, Shield, FileStack,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  canExportCcDashboard,
  isCcDashboardReadOnly,
  type CcDashboardData,
  type CcDashboardFilters,
  type CcDashboardKpiFilter,
  type CcDashboardTableRow,
} from '@/lib/cc-dashboard-records';
import {
  fetchCcDashboardData,
  logCcChangeOpened,
  logCcDashboardExport,
  logCcDashboardFilterApplied,
  logCcDashboardRefreshed,
  logCcDashboardViewed,
  openCcDashboardPdfPlaceholder,
} from '@/lib/cc-dashboard-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { CcDashboardAccessGuard } from './cc-dashboard-access-guard';
import { CcDashboardCharts } from './cc-dashboard-charts';
import { CcDashboardFiltersBar } from './cc-dashboard-filters';
import { CcDashboardActivityTimeline } from './cc-dashboard-activity';
import {
  CcCategoryBadge,
  CcDashboardStatusBadge,
  CcPriorityBadge,
  CcRiskBadge,
} from './cc-dashboard-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const defaultFrom = () => `${new Date().getFullYear()}-01-01`;
const defaultTo = () => new Date().toISOString().split('T')[0];

const KPI_ITEMS: {
  key: CcDashboardKpiFilter;
  label: string;
  metricKey: keyof CcDashboardData['metrics'];
  accent: string;
  icon?: typeof FileStack;
}[] = [
  { key: 'all', label: 'Total Change Controls', metricKey: 'total', accent: 'border-l-blue-600', icon: FileStack },
  { key: 'open', label: 'Open Changes', metricKey: 'open', accent: 'border-l-sky-600', icon: Clock },
  { key: 'closed', label: 'Closed Changes', metricKey: 'closed', accent: 'border-l-green-600', icon: CheckCircle2 },
  { key: 'draft', label: 'Draft Changes', metricKey: 'draft', accent: 'border-l-slate-500' },
  { key: 'under_qa_review', label: 'Under QA Review', metricKey: 'underQaReview', accent: 'border-l-indigo-600', icon: Shield },
  { key: 'impact_assessment', label: 'Impact Assessment Pending', metricKey: 'impactAssessmentPending', accent: 'border-l-cyan-600' },
  { key: 'risk_assessment', label: 'Risk Assessment Pending', metricKey: 'riskAssessmentPending', accent: 'border-l-violet-600', icon: AlertTriangle },
  { key: 'implementation_in_progress', label: 'Implementation In Progress', metricKey: 'implementationInProgress', accent: 'border-l-purple-600' },
  { key: 'effectiveness_pending', label: 'Effectiveness Pending', metricKey: 'effectivenessPending', accent: 'border-l-amber-600' },
  { key: 'overdue', label: 'Overdue Changes', metricKey: 'overdue', accent: 'border-l-red-600', icon: Clock },
  { key: 'critical', label: 'Critical Changes', metricKey: 'critical', accent: 'border-l-red-700', icon: AlertTriangle },
  { key: 'validation_impact', label: 'Validation Impact', metricKey: 'validationImpact', accent: 'border-l-purple-600', icon: FlaskConical },
  { key: 'csv_impact', label: 'CSV Impact', metricKey: 'csvImpact', accent: 'border-l-cyan-600', icon: Database },
  { key: 'training_impact', label: 'Training Impact', metricKey: 'trainingImpact', accent: 'border-l-orange-600', icon: GraduationCap },
  { key: 'regulatory_impact', label: 'Regulatory Impact', metricKey: 'regulatoryImpact', accent: 'border-l-indigo-700', icon: Scale },
  { key: 'capa_linked', label: 'CAPA Linked', metricKey: 'capaLinked', accent: 'border-l-rose-600', icon: Link2 },
];

function ActionLink({ row, onOpen }: { row: CcDashboardTableRow; onOpen: (id: string, num: string) => void }) {
  return (
    <Link href={`/qms/change-control/${row.id}`} onClick={() => onOpen(row.id, row.change_number)}>
      <Button variant="ghost" size="sm" className="h-8 text-blue-600">View</Button>
    </Link>
  );
}

function YesNo({ value }: { value: boolean }) {
  return value ? <span className="text-amber-700 font-medium">Yes</span> : <span className="text-muted-foreground">No</span>;
}

export function CcDashboardPage() {
  const { user, profile } = useAuth();
  const readOnly = isCcDashboardReadOnly(profile?.role);
  const canExport = canExportCcDashboard(profile?.role) && !readOnly;
  const initialized = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CcDashboardData | null>(null);
  const [filters, setFilters] = useState<CcDashboardFilters>({
    department: 'All',
    change_type: 'All',
    change_category: 'All',
    change_priority: 'All',
    date_from: defaultFrom(),
    date_to: defaultTo(),
    kpi_filter: 'all',
  });

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: profile?.role || '',
    department: profile?.department || '',
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role, profile?.department]);

  const load = useCallback(async (nextFilters = filters, auditRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCcDashboardData(nextFilters, actor);
      setData(result);
      if (auditRefresh) {
        await logCcDashboardRefreshed(actor);
        toast.success('Dashboard refreshed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [actor, filters]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void logCcDashboardViewed(actor);
    void load(filters);
  }, [actor, filters, load]);

  const handleFilterChange = (patch: Partial<CcDashboardFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    void logCcDashboardFilterApplied(actor, next);
    void load(next);
  };

  const handleKpiClick = (key: CcDashboardKpiFilter) => {
    handleFilterChange({ kpi_filter: key });
  };

  const handleOpenChange = useCallback((id: string, changeNumber: string) => {
    void logCcChangeOpened(actor, id, changeNumber);
  }, [actor]);

  const handleExportPdf = async () => {
    if (!canExport || !data) return toast.error('No export permission');
    try {
      openCcDashboardPdfPlaceholder(data, actor.name);
      await logCcDashboardExport(actor, 'PDF');
      toast.success('PDF export completed');
    } catch (e) {
      await logCcDashboardExport(actor, 'PDF');
      toast.error(e instanceof Error ? e.message : 'Change control dashboard PDF export is not available.');
    }
  };

  const handleExportExcel = async () => {
    if (!canExport || !data) return toast.error('No export permission');
    await logCcDashboardExport(actor, 'Excel');
    toast.success('Excel export placeholder — audit logged');
  };

  const recentCols = useMemo(() => [
    { key: 'change_number', header: 'Change No', render: (r: CcDashboardTableRow) => <span className="font-mono text-blue-600">{r.change_number}</span> },
    { key: 'change_date', header: 'Date', render: (r: CcDashboardTableRow) => r.change_date },
    { key: 'department', header: 'Department', render: (r: CcDashboardTableRow) => r.department },
    { key: 'change_type', header: 'Change Type', render: (r: CcDashboardTableRow) => <span className="text-xs">{r.change_type}</span> },
    { key: 'change_category', header: 'Category', render: (r: CcDashboardTableRow) => <CcCategoryBadge category={r.change_category} /> },
    { key: 'change_priority', header: 'Priority', render: (r: CcDashboardTableRow) => <CcPriorityBadge priority={r.change_priority} /> },
    { key: 'status', header: 'Status', render: (r: CcDashboardTableRow) => <CcDashboardStatusBadge status={r.status} /> },
    { key: 'owner', header: 'Owner', render: (r: CcDashboardTableRow) => r.owner },
    { key: 'due_date', header: 'Due Date', render: (r: CcDashboardTableRow) => r.due_date },
    { key: 'actions', header: 'Action', render: (r: CcDashboardTableRow) => <ActionLink row={r} onOpen={handleOpenChange} /> },
  ], [handleOpenChange]);

  const overdueCols = useMemo(() => [
    { key: 'change_number', header: 'Change No', render: (r: CcDashboardTableRow) => <span className="font-mono">{r.change_number}</span> },
    { key: 'department', header: 'Department', render: (r: CcDashboardTableRow) => r.department },
    { key: 'change_category', header: 'Category', render: (r: CcDashboardTableRow) => <CcCategoryBadge category={r.change_category} /> },
    { key: 'due_date', header: 'Due Date', render: (r: CcDashboardTableRow) => r.due_date },
    { key: 'days_overdue', header: 'Days Overdue', render: (r: CcDashboardTableRow) => <span className="text-red-600 font-medium">{r.days_overdue}</span> },
    { key: 'owner', header: 'Owner', render: (r: CcDashboardTableRow) => r.owner },
    { key: 'status', header: 'Status', render: (r: CcDashboardTableRow) => <CcDashboardStatusBadge status={r.status} /> },
    { key: 'actions', header: 'Action', render: (r: CcDashboardTableRow) => <ActionLink row={r} onOpen={handleOpenChange} /> },
  ], [handleOpenChange]);

  const criticalCols = useMemo(() => [
    { key: 'change_number', header: 'Change No', render: (r: CcDashboardTableRow) => <span className="font-mono">{r.change_number}</span> },
    { key: 'change_title', header: 'Change Title', render: (r: CcDashboardTableRow) => <span className="line-clamp-1 max-w-xs">{r.change_title}</span> },
    { key: 'validation_impact', header: 'Validation Impact', render: (r: CcDashboardTableRow) => <YesNo value={r.validation_impact} /> },
    { key: 'csv_impact', header: 'CSV Impact', render: (r: CcDashboardTableRow) => <YesNo value={r.csv_impact} /> },
    { key: 'regulatory_impact', header: 'Regulatory Impact', render: (r: CcDashboardTableRow) => <YesNo value={r.regulatory_impact} /> },
    { key: 'risk_level', header: 'Risk Level', render: (r: CcDashboardTableRow) => <CcRiskBadge level={r.risk_level} /> },
    { key: 'status', header: 'Status', render: (r: CcDashboardTableRow) => <CcDashboardStatusBadge status={r.status} /> },
    { key: 'actions', header: 'Action', render: (r: CcDashboardTableRow) => <ActionLink row={r} onOpen={handleOpenChange} /> },
  ], [handleOpenChange]);

  return (
    <CcDashboardAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Change Control Dashboard"
          description="Monitor GMP change controls, impact assessment, implementation and effectiveness"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/change-control' },
            { label: 'Change Control', href: '/qms/change-control' },
            { label: 'Dashboard' },
          ]}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void load(filters, true)} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />Refresh
              </Button>
              {canExport && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handleExportPdf()}>
                    <FileText className="mr-2 h-4 w-4" />Export PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleExportExcel()}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />Export Excel
                  </Button>
                </>
              )}
              {!readOnly && (
                <Link href="/qms/change-control/create">
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="mr-2 h-4 w-4" />Create Change
                  </Button>
                </Link>
              )}
            </div>
          )}
        />

        <CcDashboardFiltersBar
          filters={filters}
          departments={data?.departments || ['All']}
          onChange={handleFilterChange}
        />

        {loading && !data ? (
          <LoadingSkeleton rows={8} />
        ) : error ? (
          <ErrorCard title="Unable to load dashboard" message={error} onRetry={() => void load(filters, true)} />
        ) : data ? (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {KPI_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = filters.kpi_filter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleKpiClick(item.key)}
                    className={cn('text-left transition-opacity', active && 'ring-2 ring-blue-500 rounded-lg')}
                  >
                    <KpiCard
                      label={item.label}
                      value={data.metrics[item.metricKey]}
                      icon={Icon}
                      accent={item.accent}
                    />
                  </button>
                );
              })}
            </div>

            {data.metrics.averageClosureDays > 0 && (
              <p className="text-sm text-muted-foreground">
                Average closure time: <strong>{data.metrics.averageClosureDays}</strong> days
              </p>
            )}

            {data.filteredCount === 0 && data.metrics.total === 0 ? (
              <EmptyState
                title="No change controls found"
                message="Create a change control record or adjust filters to see dashboard data."
              />
            ) : (
              <>
                <CcDashboardCharts charts={data.charts} />

                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="lg:col-span-2 border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CcDashboardActivityTimeline entries={data.activity} />
                    </CardContent>
                  </Card>
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Filter Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2 text-muted-foreground">
                      <p>Showing <strong className="text-foreground">{data.filteredCount || data.metrics.total}</strong> records</p>
                      <p>KPI filter: <strong className="text-foreground">{filters.kpi_filter.replace(/_/g, ' ')}</strong></p>
                      <p>Department: <strong className="text-foreground">{filters.department}</strong></p>
                      <p>Date range: <strong className="text-foreground">{filters.date_from} — {filters.date_to}</strong></p>
                    </CardContent>
                  </Card>
                </div>

                <Tabs defaultValue="recent">
                  <TabsList className="flex h-auto flex-wrap">
                    <TabsTrigger value="recent">Recent Changes</TabsTrigger>
                    <TabsTrigger value="overdue">Overdue Changes</TabsTrigger>
                    <TabsTrigger value="critical">Critical / High Impact</TabsTrigger>
                  </TabsList>
                  <TabsContent value="recent" className="mt-4">
                    <Card className="border-slate-200 shadow-sm">
                      <CardContent className="p-4">
                        <ResponsiveDataTable
                          columns={recentCols}
                          data={data.recentChanges}
                          mobileTitleKey="change_number"
                          mobileSubtitleKey="change_title"
                          pageSize={10}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="overdue" className="mt-4">
                    <Card className="border-slate-200 shadow-sm">
                      <CardContent className="p-4">
                        {data.overdueChanges.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-6 text-center">No overdue changes.</p>
                        ) : (
                          <ResponsiveDataTable
                            columns={overdueCols}
                            data={data.overdueChanges}
                            mobileTitleKey="change_number"
                            mobileSubtitleKey="owner"
                            pageSize={10}
                          />
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="critical" className="mt-4">
                    <Card className="border-slate-200 shadow-sm">
                      <CardContent className="p-4">
                        <ResponsiveDataTable
                          columns={criticalCols}
                          data={data.criticalChanges}
                          mobileTitleKey="change_title"
                          mobileSubtitleKey="change_number"
                          pageSize={10}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        ) : null}
      </div>
    </CcDashboardAccessGuard>
  );
}
