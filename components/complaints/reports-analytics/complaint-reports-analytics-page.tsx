'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, Download, FileSpreadsheet, FileText, Printer, RefreshCw, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  COMPLAINT_PREVIEW_COLUMNS,
  COMPLAINT_REPORT_FILTER_OPTIONS,
  COMPLAINT_REPORT_TYPES,
  canExportComplaintReports,
  canGenerateComplaintReports,
  complaintReportFormSchema,
  complaintReportStatusColor,
  getAvailableComplaintReportTypes,
  isComplaintReportsReadOnly,
  type ComplaintReportAnalyticsResult,
  type ComplaintReportPreviewRow,
} from '@/lib/complaint-reports-records';
import {
  exportComplaintReport,
  fetchComplaintReportMarketOptions,
  fetchComplaintReportProductOptions,
  fetchComplaintReportRecords,
  fetchComplaintReportsDashboard,
  generateComplaintReport,
  logComplaintReportDownloaded,
  logComplaintReportPreviewed,
  previewComplaintReport,
} from '@/lib/complaint-reports-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { ComplaintReportsAccessGuard } from './complaint-reports-access-guard';
import { ComplaintReportsCharts } from './complaint-reports-charts';
import { ComplaintAggregateReportPdf } from './complaint-aggregate-report-pdf';
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
import type { ComplaintDashboardChartData, ComplaintReportRecord } from '@/lib/complaint-types';
import type { ComplaintReportFormData } from '@/lib/complaint-reports-records';

const WIZARD_STEPS = ['Report Type', 'Date Range', 'Filters', 'Preview & Analytics', 'Export & Save'];

const defaultFrom = () => `${new Date().getFullYear()}-01-01`;
const defaultTo = () => new Date().toISOString().split('T')[0];

type DashboardMetrics = ComplaintReportAnalyticsResult['metrics'];

function ReportStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', complaintReportStatusColor(status))}>
      {status}
    </span>
  );
}

export function ComplaintReportsAnalyticsPage() {
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canExport = canExportComplaintReports(role);
  const readOnly = isComplaintReportsReadOnly(role);
  const availableTypes = useMemo(() => getAvailableComplaintReportTypes(role), [role]);
  const canGenerate = availableTypes.length > 0;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ComplaintReportRecord[]>([]);
  const [products, setProducts] = useState<string[]>(['All']);
  const [markets, setMarkets] = useState<string[]>(['All']);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [dashboardCharts, setDashboardCharts] = useState<ComplaintDashboardChartData | null>(null);
  const [dashboardStatus, setDashboardStatus] = useState<{ name: string; count: number }[]>([]);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [reportType, setReportType] = useState<ComplaintReportFormData['report_type']>('Complaint Register');
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [complaintNumber, setComplaintNumber] = useState('');
  const [product, setProduct] = useState('All');
  const [batchNumber, setBatchNumber] = useState('');
  const [marketRegion, setMarketRegion] = useState('All');
  const [customerName, setCustomerName] = useState('');
  const [category, setCategory] = useState('All');
  const [criticality, setCriticality] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [capaRequired, setCapaRequired] = useState('All');
  const [recallRequired, setRecallRequired] = useState('All');

  const [analytics, setAnalytics] = useState<ComplaintReportAnalyticsResult | null>(null);
  const [savedReport, setSavedReport] = useState<ComplaintReportRecord | null>(null);
  const [showPdf, setShowPdf] = useState(false);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || 'System',
    role: role || '',
  }), [user?.uid, profile?.full_name, role]);

  const formData = useMemo((): ComplaintReportFormData => ({
    report_type: reportType,
    review_period_from: periodFrom,
    review_period_to: periodTo,
    complaint_number: complaintNumber,
    product,
    batch_number: batchNumber,
    market_region: marketRegion,
    customer_name: customerName,
    complaint_category: category,
    criticality,
    status: statusFilter,
    capa_required: capaRequired,
    recall_required: recallRequired,
  }), [reportType, periodFrom, periodTo, complaintNumber, product, batchNumber, marketRegion, customerName, category, criticality, statusFilter, capaRequired, recallRequired]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods, mkts, dash] = await Promise.all([
        fetchComplaintReportRecords(),
        fetchComplaintReportProductOptions(),
        fetchComplaintReportMarketOptions(),
        fetchComplaintReportsDashboard(),
      ]);
      setHistory(rows);
      setProducts(prods);
      setMarkets(mkts);
      setDashboardMetrics(dash.metrics);
      setDashboardCharts(dash.charts);
      setDashboardStatus(dash.byStatus);
    } catch {
      setError('Failed to load reports and analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runPreview = async () => {
    const parsed = complaintReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid report parameters');
      return;
    }
    if (!canGenerateComplaintReports(role, parsed.data.report_type)) {
      toast.error('You do not have permission to generate this report type');
      return;
    }
    setPreviewing(true);
    try {
      const result = await previewComplaintReport({
        report_type: parsed.data.report_type,
        review_period_from: parsed.data.review_period_from,
        review_period_to: parsed.data.review_period_to,
        complaint_number: parsed.data.complaint_number,
        product: parsed.data.product,
        batch_number: parsed.data.batch_number,
        market_region: parsed.data.market_region,
        customer_name: parsed.data.customer_name,
        complaint_category: parsed.data.complaint_category,
        criticality: parsed.data.criticality,
        status: parsed.data.status,
        capa_required: parsed.data.capa_required,
        recall_required: parsed.data.recall_required,
      });
      setAnalytics(result);
      setStep(3);
      await logComplaintReportPreviewed(actor, parsed.data.report_type, result.filtered_count);
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
    if (!canGenerate || readOnly) {
      toast.error('No permission to generate reports');
      return;
    }
    if (!analytics) {
      toast.error('Preview a report first');
      return;
    }
    const parsed = complaintReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
      return;
    }
    if (!canGenerateComplaintReports(role, parsed.data.report_type)) {
      toast.error('You do not have permission to save this report type');
      return;
    }
    setSaving(true);
    const { record, error: err } = await generateComplaintReport(parsed.data, actor, history.length);
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
      complaint_number_filter: complaintNumber,
      product,
      batch_number: batchNumber,
      market_region: marketRegion,
      customer_name: customerName,
      complaint_category: category,
      criticality,
      status_filter: statusFilter,
      capa_required_filter: capaRequired,
      recall_required_filter: recallRequired,
      generated_by: actor.id,
      generated_by_name: actor.name,
      generated_date: new Date().toISOString().split('T')[0],
      total_records: analytics?.filtered_count ?? 0,
      export_type: type,
      file_url: '',
      report_status: 'Generated',
      summary: analytics?.summary || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as ComplaintReportRecord;

    try {
      if (savedReport) {
        await exportComplaintReport(savedReport, type, actor);
        await logComplaintReportDownloaded(actor, savedReport.id, savedReport.report_number);
      } else {
        await exportComplaintReport(report, type, actor);
      }
      if (type === 'PDF') setShowPdf(true);
      toast.success(`${type} export requested via backend`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Complaint report export is not available.');
    }
  };

  const historyColumns = useMemo(() => [
    { key: 'report_number', header: 'Report No', render: (r: ComplaintReportRecord) => <span className="font-mono text-blue-600">{r.report_number}</span> },
    { key: 'report_type', header: 'Type' },
    { key: 'period', header: 'Period', render: (r: ComplaintReportRecord) => `${r.review_period_from} → ${r.review_period_to}` },
    { key: 'total', header: 'Records', render: (r: ComplaintReportRecord) => r.total_records },
    { key: 'status', header: 'Status', render: (r: ComplaintReportRecord) => <ReportStatusBadge status={r.report_status} /> },
    { key: 'export', header: 'Export', render: (r: ComplaintReportRecord) => r.export_type || '—' },
    { key: 'generated', header: 'Generated', render: (r: ComplaintReportRecord) => r.generated_date },
    {
      key: 'actions',
      header: 'Action',
      render: (r: ComplaintReportRecord) => canExport ? (
        <Button variant="ghost" size="sm" onClick={() => void logComplaintReportDownloaded(actor, r.id, r.report_number).then(() => toast.success('Download request logged'))}>
          <Download className="h-4 w-4" />
        </Button>
      ) : null,
    },
  ], [canExport, actor]);

  const previewTableData = useMemo(
    () => (analytics?.previewRows ?? []).map((row, i) => ({ id: row.complaint_number || String(i), ...row })),
    [analytics?.previewRows],
  );

  const previewTableColumns = COMPLAINT_PREVIEW_COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    render: (r: ComplaintReportPreviewRow & { id?: string }) => String(r[c.key as keyof ComplaintReportPreviewRow] ?? '—'),
  }));

  const reportTypeOptions = availableTypes.length ? availableTypes : [...COMPLAINT_REPORT_TYPES];

  return (
    <ComplaintReportsAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Complaint Reports & Analytics"
          description="Generate complaint reports, trends and management insights"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/complaints' },
            { label: 'Complaint Management', href: '/qms/complaints' },
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
              {dashboardMetrics && dashboardCharts && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-10">
                    <KpiCard label="Total Complaints" value={dashboardMetrics.total} />
                    <KpiCard label="Open Complaints" value={dashboardMetrics.open} tone="amber" />
                    <KpiCard label="Closed Complaints" value={dashboardMetrics.closed} tone="green" />
                    <KpiCard label="Overdue Complaints" value={dashboardMetrics.overdue} tone="red" />
                    <KpiCard label="Critical Complaints" value={dashboardMetrics.critical} tone="red" />
                    <KpiCard label="CAPA Linked" value={dashboardMetrics.capaLinked} tone="blue" />
                    <KpiCard label="Recall Eval. Required" value={dashboardMetrics.recallEvaluationRequired} tone="red" />
                    <KpiCard label="Avg Closure Days" value={dashboardMetrics.avgClosureDays} />
                    <KpiCard label="Repeat Complaints" value={dashboardMetrics.repeatComplaints} tone="amber" />
                    <KpiCard label="Customer Response Pending" value={dashboardMetrics.customerResponsePending} tone="amber" />
                  </div>
                  <ComplaintReportsCharts charts={dashboardCharts} metrics={dashboardMetrics} byStatus={dashboardStatus} />
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
                <EmptyState title="No saved reports" message="Generate a complaint report to build GMP-compliant report history." />
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
                  <Select value={reportType} onValueChange={(v) => setReportType(v as ComplaintReportFormData['report_type'])} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {reportTypeOptions.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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
                  <Label>Complaint Number</Label>
                  <Input value={complaintNumber} onChange={(e) => setComplaintNumber(e.target.value)} disabled={readOnly} placeholder="Search..." />
                </div>
                <div className="space-y-1">
                  <Label>Product</Label>
                  <Select value={product} onValueChange={setProduct} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{products.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Batch Number</Label>
                  <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} disabled={readOnly} />
                </div>
                <div className="space-y-1">
                  <Label>Market</Label>
                  <Select value={marketRegion} onValueChange={setMarketRegion} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{markets.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Customer</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} disabled={readOnly} />
                </div>
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COMPLAINT_REPORT_FILTER_OPTIONS.categories.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Criticality</Label>
                  <Select value={criticality} onValueChange={setCriticality} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COMPLAINT_REPORT_FILTER_OPTIONS.criticalities.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COMPLAINT_REPORT_FILTER_OPTIONS.statuses.map((o) => <SelectItem key={o} value={o}>{o.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>CAPA Required</Label>
                  <Select value={capaRequired} onValueChange={setCapaRequired} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COMPLAINT_REPORT_FILTER_OPTIONS.yesNo.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Recall Required</Label>
                  <Select value={recallRequired} onValueChange={setRecallRequired} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COMPLAINT_REPORT_FILTER_OPTIONS.yesNo.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
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
                    <p><strong>Management:</strong> {analytics.management_summary}</p>
                  </CardContent>
                </Card>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <KpiCard label="Records" value={analytics.filtered_count} />
                  <KpiCard label="Open" value={analytics.metrics.open} tone="amber" />
                  <KpiCard label="Critical" value={analytics.metrics.critical} tone="red" />
                  <KpiCard label="CAPA Linked" value={analytics.metrics.capaLinked} tone="blue" />
                </div>

                {previewTableData.length ? (
                  <ResponsiveDataTable
                    columns={previewTableColumns}
                    data={previewTableData}
                    mobileTitleKey="complaint_number"
                    mobileSubtitleKey="customer_name"
                    pageSize={8}
                  />
                ) : (
                  <EmptyState title="No records" message="Adjust filters or report type to include complaint data." />
                )}

                {step === 3 && analytics.filtered_count > 0 && (
                  <ComplaintReportsCharts charts={analytics.charts} metrics={analytics.metrics} byStatus={analytics.byStatus} />
                )}

                <DialogFooter className="flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                  {canGenerate && !readOnly && (
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
            <ComplaintAggregateReportPdf
              reportNumber={savedReport?.report_number || `PREVIEW-${Date.now()}`}
              reportType={reportType}
              filters={formData}
              previewRows={analytics.previewRows}
              metrics={analytics.metrics}
              summary={analytics.summary}
              managementSummary={analytics.management_summary}
              investigationSummary={analytics.investigation_summary}
              capaSummary={analytics.capa_summary}
              recallSummary={analytics.recall_summary}
              generatedBy={actor.name}
              generatedDate={new Date().toISOString().split('T')[0]}
            />
          </div>
        )}
      </div>
    </ComplaintReportsAccessGuard>
  );
}
