'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, Download, FileSpreadsheet, FileText, Printer, RefreshCw, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  OOS_PREVIEW_COLUMNS,
  OOS_REPORT_FILTER_OPTIONS,
  OOS_REPORT_TYPES,
  canExportOosReports,
  canGenerateOosReportType,
  canGenerateOosReports,
  isOosReportsReadOnly,
  oosReportFormSchema,
  reportStatusColor,
  type OosReportAnalyticsResult,
  type OosReportFormData,
  type OosReportPreviewRow,
} from '@/lib/oos-reports-records';
import {
  exportOosReport,
  fetchOosDashboardAnalytics,
  fetchOosReportBatchOptions,
  fetchOosReportDepartmentOptions,
  fetchOosReportProductOptions,
  fetchOosReportRecords,
  fetchOosReportTestOptions,
  generateOosReport,
  logOosReportDownloaded,
  logOosReportPreviewed,
  previewOosReport,
} from '@/lib/oos-reports-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { OosReportsAccessGuard } from './oos-reports-access-guard';
import { OosReportsCharts } from './oos-reports-charts';
import { OosAggregateReportPdf } from './oos-aggregate-report-pdf';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { OosDashboardMetrics, OosReportRecord } from '@/lib/oos-types';

const WIZARD_STEPS = ['Report Type', 'Date Range', 'Filters', 'Preview & Analytics', 'Export & Save'];

const defaultFrom = () => `${new Date().getFullYear()}-01-01`;
const defaultTo = () => new Date().toISOString().split('T')[0];

function ReportStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', reportStatusColor(status))}>
      {status}
    </span>
  );
}

export function OosReportsAnalyticsPage() {
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canGenerate = canGenerateOosReports(role);
  const canExport = canExportOosReports(role);
  const readOnly = isOosReportsReadOnly(role);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<OosReportRecord[]>([]);
  const [products, setProducts] = useState<string[]>(['All']);
  const [departments, setDepartments] = useState<string[]>(['All']);
  const [tests, setTests] = useState<string[]>(['All']);
  const [batches, setBatches] = useState<string[]>(['All']);
  const [dashboardMetrics, setDashboardMetrics] = useState<OosDashboardMetrics | null>(null);
  const [dashboardStatus, setDashboardStatus] = useState<{ name: string; count: number }[]>([]);
  const [phase1Completed, setPhase1Completed] = useState(0);
  const [phase2Completed, setPhase2Completed] = useState(0);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [reportType, setReportType] = useState<OosReportFormData['report_type']>('OOS Register');
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [department, setDepartment] = useState('All');
  const [product, setProduct] = useState('All');
  const [batchNumber, setBatchNumber] = useState('All');
  const [testName, setTestName] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [rootCause, setRootCause] = useState('All');

  const [analytics, setAnalytics] = useState<OosReportAnalyticsResult | null>(null);
  const [savedReport, setSavedReport] = useState<OosReportRecord | null>(null);
  const [showPdf, setShowPdf] = useState(false);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || 'System',
    role: role || '',
  }), [user?.uid, profile?.full_name, role]);

  const allowedReportTypes = useMemo(
    () => OOS_REPORT_TYPES.filter((t) => canGenerateOosReportType(role, t)),
    [role],
  );

  const formData = useMemo((): OosReportFormData => ({
    report_type: reportType,
    review_period_from: periodFrom,
    review_period_to: periodTo,
    department,
    product,
    batch_number: batchNumber,
    test_name: testName,
    status: statusFilter,
    root_cause_category: rootCause,
  }), [reportType, periodFrom, periodTo, department, product, batchNumber, testName, statusFilter, rootCause]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods, depts, testOpts, batchOpts, dash] = await Promise.all([
        fetchOosReportRecords(),
        fetchOosReportProductOptions(),
        fetchOosReportDepartmentOptions(),
        fetchOosReportTestOptions(),
        fetchOosReportBatchOptions(),
        fetchOosDashboardAnalytics(),
      ]);
      setHistory(rows);
      setProducts(prods);
      setDepartments(depts);
      setTests(testOpts);
      setBatches(batchOpts);
      setDashboardMetrics(dash.metrics);
      setDashboardStatus(dash.byStatus);
      setPhase1Completed(dash.phase1_completed);
      setPhase2Completed(dash.phase2_completed);
    } catch {
      setError('Failed to load OOS reports and analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runPreview = async () => {
    if (!canGenerateOosReportType(role, reportType)) {
      toast.error('Your role cannot generate this report type');
      return;
    }
    const parsed = oosReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid report parameters');
      return;
    }
    setPreviewing(true);
    try {
      const result = await previewOosReport({
        report_type: parsed.data.report_type,
        review_period_from: parsed.data.review_period_from,
        review_period_to: parsed.data.review_period_to,
        department: parsed.data.department,
        product: parsed.data.product,
        batch_number: parsed.data.batch_number,
        test_name: parsed.data.test_name,
        status: parsed.data.status,
        root_cause_category: parsed.data.root_cause_category,
      });
      setAnalytics(result);
      setStep(3);
      await logOosReportPreviewed(actor, parsed.data.report_type, result.filtered_count);
      if (result.filtered_count === 0) {
        toast.message('No records match — empty preview shown');
      } else {
        toast.success(`Preview: ${result.filtered_count} record(s)`);
      }
    } catch {
      toast.error('Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const saveReport = async () => {
    if (!canGenerate || readOnly || !canGenerateOosReportType(role, reportType)) {
      toast.error('No permission to generate reports');
      return;
    }
    if (!analytics) {
      toast.error('Preview a report first');
      return;
    }
    const parsed = oosReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
      return;
    }
    setSaving(true);
    const { record, error: err } = await generateOosReport(parsed.data, actor, history.length);
    setSaving(false);
    if (err || !record) toast.error(err || 'Save failed');
    else {
      setSavedReport(record);
      setStep(4);
      toast.success(`Report ${record.report_number} saved`);
      await load();
    }
  };

  const handleExport = async (type: 'PDF' | 'Excel' | 'CSV') => {
    if (!canExport) {
      toast.error('No export permission');
      return;
    }
    if (!analytics && !savedReport) {
      toast.error('Generate or preview a report first');
      return;
    }
    const report = savedReport || {
      id: 'preview',
      report_id: 'preview',
      report_number: `PREVIEW-${Date.now()}`,
      report_type: reportType,
      review_period_from: periodFrom,
      review_period_to: periodTo,
      department,
      product,
      batch_number: batchNumber,
      test_name: testName,
      root_cause_category: rootCause,
      status_filter: statusFilter,
      generated_by: actor.id,
      generated_by_name: actor.name,
      generated_date: new Date().toISOString().split('T')[0],
      total_records: analytics?.filtered_count ?? 0,
      export_type: type,
      file_url: '',
      report_status: 'Generated',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as OosReportRecord;

    try {
      if (savedReport) {
        await exportOosReport(savedReport, type, actor);
        await logOosReportDownloaded(actor, savedReport.id, savedReport.report_number);
      } else {
        await exportOosReport(report, type, actor);
      }
      if (type === 'PDF') setShowPdf(true);
      toast.success(`${type} export requested via backend`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'OOS report export is not available.');
    }
  };

  const historyColumns = useMemo(() => [
    { key: 'report_number', header: 'Report No', render: (r: OosReportRecord) => <span className="font-mono text-blue-600">{r.report_number}</span> },
    { key: 'report_type', header: 'Type' },
    { key: 'period', header: 'Period', render: (r: OosReportRecord) => `${r.review_period_from} → ${r.review_period_to}` },
    { key: 'total', header: 'Records', render: (r: OosReportRecord) => r.total_records },
    { key: 'status', header: 'Status', render: (r: OosReportRecord) => <ReportStatusBadge status={r.report_status} /> },
    { key: 'export', header: 'Export', render: (r: OosReportRecord) => r.export_type || '—' },
    { key: 'generated', header: 'Generated', render: (r: OosReportRecord) => r.generated_date },
    {
      key: 'actions',
      header: 'Action',
      render: (r: OosReportRecord) => canExport ? (
        <Button variant="ghost" size="sm" onClick={() => void logOosReportDownloaded(actor, r.id, r.report_number).then(() => toast.success('Download request logged'))}>
          <Download className="h-4 w-4" />
        </Button>
      ) : null,
    },
  ], [canExport, actor]);

  const previewTableData = useMemo(
    () => (analytics?.previewRows ?? []).map((row, i) => ({ id: row.oos_number || String(i), ...row })),
    [analytics?.previewRows],
  );

  const previewTableColumns = OOS_PREVIEW_COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    render: (r: OosReportPreviewRow & { id?: string }) => String(r[c.key as keyof OosReportPreviewRow] ?? '—'),
  }));

  return (
    <OosReportsAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="OOS Reports & Analytics"
          description="GMP-compliant OOS reports, investigation summaries, trend reports, and management analytics"
          trail={[
            { label: 'QMS', href: '/qms/oos' },
            { label: 'OOS Management', href: '/qms/oos' },
            { label: 'Reports & Analytics' },
          ]}
          actions={canGenerate && !readOnly ? (
            <Button onClick={() => { setWizardOpen(true); setStep(0); setAnalytics(null); setSavedReport(null); }}>
              <FileText className="mr-2 h-4 w-4" /> Generate Report
            </Button>
          ) : undefined}
        />

        {loading ? <LoadingSkeleton rows={3} /> : error ? (
          <ErrorCard title="Load error" message={error} />
        ) : (
          <Tabs defaultValue="dashboard">
            <TabsList className="flex h-auto flex-wrap gap-1">
              <TabsTrigger value="dashboard">Analytics Dashboard</TabsTrigger>
              <TabsTrigger value="history">Report History ({history.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard" className="mt-4 space-y-6">
              {dashboardMetrics && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <KpiCard label="Total OOS" value={dashboardMetrics.total} />
                    <KpiCard label="Open OOS" value={dashboardMetrics.open} tone="amber" />
                    <KpiCard label="Closed OOS" value={dashboardMetrics.closed} tone="green" />
                    <KpiCard label="Overdue OOS" value={dashboardMetrics.overdue} tone="red" />
                    <KpiCard label="Critical OOS" value={dashboardMetrics.critical} tone="red" />
                    <KpiCard label="CAPA Linked" value={dashboardMetrics.capaLinked} tone="blue" />
                    <KpiCard label="Phase-I Completed" value={phase1Completed} tone="green" />
                    <KpiCard label="Phase-II Completed" value={phase2Completed} tone="green" />
                    <KpiCard label="Avg Closure Days" value={dashboardMetrics.avgClosureDays} />
                  </div>
                  <OosReportsCharts metrics={dashboardMetrics} byStatus={dashboardStatus} />
                </>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-4">
              {history.length ? (
                <ResponsiveDataTable
                  columns={historyColumns}
                  data={history}
                  mobileTitleKey="report_number"
                  mobileSubtitleKey="report_type"
                  pageSize={10}
                />
              ) : (
                <EmptyState title="No saved reports" message="Generate an OOS report to build GMP-compliant report history." />
              )}
            </TabsContent>
          </Tabs>
        )}

        <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Report Generation Wizard</DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap gap-1 mb-4">
              {WIZARD_STEPS.map((label, i) => (
                <div key={label} className={cn('flex items-center text-xs', i <= step ? 'text-blue-700 font-medium' : 'text-muted-foreground')}>
                  {i > 0 && <ChevronRight className="h-3 w-3 mx-1" />}
                  {label}
                </div>
              ))}
            </div>

            {step === 0 && (
              <div className="space-y-4">
                <div className="space-y-1">
                  <Label>Report Type *</Label>
                  <Select value={reportType} onValueChange={(v) => setReportType(v as OosReportFormData['report_type'])} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {allowedReportTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button onClick={() => setStep(1)}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
                </DialogFooter>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Review Period From *</Label>
                  <Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} disabled={readOnly} />
                </div>
                <div className="space-y-1">
                  <Label>Review Period To *</Label>
                  <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} disabled={readOnly} />
                </div>
                <DialogFooter className="sm:col-span-2">
                  <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
                  <Button onClick={() => setStep(2)}>Next</Button>
                </DialogFooter>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Department</Label>
                  <Select value={department} onValueChange={setDepartment} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {departments.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Product</Label>
                  <Select value={product} onValueChange={setProduct} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {products.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Batch</Label>
                  <Select value={batchNumber} onValueChange={setBatchNumber} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {batches.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Test</Label>
                  <Select value={testName} onValueChange={setTestName} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {tests.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OOS_REPORT_FILTER_OPTIONS.statuses.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Root Cause</Label>
                  <Select value={rootCause} onValueChange={setRootCause} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OOS_REPORT_FILTER_OPTIONS.rootCauses.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter className="sm:col-span-2">
                  <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                  <Button onClick={() => void runPreview()} disabled={previewing}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${previewing ? 'animate-spin' : ''}`} />
                    Preview Report
                  </Button>
                </DialogFooter>
              </div>
            )}

            {step >= 3 && analytics && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Summary</CardTitle></CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-2">
                    <p>{analytics.summary}</p>
                    <p>{analytics.investigation_summary}</p>
                    <p>{analytics.capa_summary}</p>
                  </CardContent>
                </Card>

                <div className="grid gap-3 sm:grid-cols-4">
                  <KpiCard label="Records" value={analytics.filtered_count} />
                  <KpiCard label="Open" value={analytics.metrics.open} tone="amber" />
                  <KpiCard label="Critical" value={analytics.metrics.critical} tone="red" />
                  <KpiCard label="CAPA Linked" value={analytics.metrics.capaLinked} tone="blue" />
                </div>

                {previewTableData.length ? (
                  <ResponsiveDataTable
                    columns={previewTableColumns}
                    data={previewTableData}
                    mobileTitleKey="oos_number"
                    mobileSubtitleKey="department"
                    pageSize={8}
                  />
                ) : (
                  <EmptyState title="No records" message="Adjust filters or report type to include OOS data." />
                )}

                {step === 3 && (
                  <OosReportsCharts metrics={analytics.metrics} byStatus={analytics.byStatus} />
                )}

                <DialogFooter className="flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                  {canGenerate && !readOnly && canGenerateOosReportType(role, reportType) && (
                    <Button onClick={() => void saveReport()} disabled={saving}>
                      <Save className="mr-2 h-4 w-4" /> {saving ? 'Saving...' : 'Save Report'}
                    </Button>
                  )}
                  {canExport && (
                    <>
                      <Button variant="outline" onClick={() => void handleExport('PDF')}>
                        <Printer className="mr-2 h-4 w-4" /> PDF
                      </Button>
                      <Button variant="outline" onClick={() => void handleExport('Excel')}>
                        <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
                      </Button>
                      <Button variant="outline" onClick={() => void handleExport('CSV')}>
                        <Download className="mr-2 h-4 w-4" /> CSV
                      </Button>
                    </>
                  )}
                </DialogFooter>
              </div>
            )}

            {step === 4 && savedReport && (
              <div className="space-y-4">
                <p className="text-sm text-green-700">Report {savedReport.report_number} saved successfully.</p>
                <DialogFooter>
                  <Button onClick={() => setWizardOpen(false)}>Close</Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {showPdf && analytics && (
          <div className="hidden print:block">
            <OosAggregateReportPdf
              reportNumber={savedReport?.report_number || `PREVIEW-${Date.now()}`}
              reportType={reportType}
              filters={formData}
              previewRows={analytics.previewRows}
              metrics={analytics.metrics}
              summary={analytics.summary}
              investigationSummary={analytics.investigation_summary}
              capaSummary={analytics.capa_summary}
              generatedBy={actor.name}
              generatedDate={new Date().toISOString().split('T')[0]}
            />
          </div>
        )}
      </div>
    </OosReportsAccessGuard>
  );
}
