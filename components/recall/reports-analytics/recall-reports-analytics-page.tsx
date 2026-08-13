'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, Download, FileSpreadsheet, FileText, Printer, RefreshCw, Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  RECALL_PREVIEW_COLUMNS,
  RECALL_REPORT_FILTER_OPTIONS,
  RECALL_REPORT_TYPES,
  canExportRecallReportsModule,
  canGenerateRecallReportTypeModule,
  canGenerateRecallReportsModule,
  canViewRecallManagementReviewModule,
  recallReportFormSchema,
  isRecallReportsReadOnlyModule,
  reportStatusColor,
  type RecallReportAnalyticsResult,
  type RecallReportFormData,
} from '@/lib/recall-reports-records';
import {
  exportRecallReport,
  fetchRecallDashboardAnalytics,
  fetchRecallExportHistory,
  fetchRecallReportMarketOptions,
  fetchRecallReportProductOptions,
  fetchRecallReportRecords,
  generateRecallReport,
  logManagementReportViewed,
  logRecallReportDownloaded,
  logRecallReportPreviewed,
  logRecallReportPrinted,
  logRecallReportsModuleViewed,
  previewRecallReport,
} from '@/lib/recall-reports-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { RecallReportsAccessGuard } from './recall-reports-access-guard';
import { RecallReportsAnalyticsKpis, RecallReportsCharts } from './recall-reports-charts';
import { RecallAggregateReportPdf } from './recall-aggregate-report-pdf';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type {
  RecallManagementReviewSummary,
  RecallReportAnalyticsMetrics,
  RecallReportChartData,
  RecallReportPreviewRow,
  RecallReportRecord,
} from '@/lib/recall-types';

const WIZARD_STEPS = ['Report Type', 'Date Range', 'Filters', 'Preview & Analytics', 'Export & Save'];
const defaultFrom = () => `${new Date().getFullYear()}-01-01`;
const defaultTo = () => new Date().toISOString().split('T')[0];

function ReportStatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', reportStatusColor(status))}>
      {status}
    </span>
  );
}

export function RecallReportsAnalyticsPage({ defaultTab = 'generator' }: { defaultTab?: string }) {
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canGenerate = useMemo(
    () => RECALL_REPORT_TYPES.some((t) => canGenerateRecallReportTypeModule(role, t)),
    [role],
  );
  const canExport = canExportRecallReportsModule(role);
  const canManagement = canViewRecallManagementReviewModule(role);
  const readOnly = isRecallReportsReadOnlyModule(role);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RecallReportRecord[]>([]);
  const [exportHistory, setExportHistory] = useState<RecallReportRecord[]>([]);
  const [products, setProducts] = useState<string[]>(['All']);
  const [markets, setMarkets] = useState<string[]>(['All']);
  const [dashboardMetrics, setDashboardMetrics] = useState<RecallReportAnalyticsMetrics | null>(null);
  const [dashboardCharts, setDashboardCharts] = useState<RecallReportChartData | null>(null);
  const [managementReview, setManagementReview] = useState<RecallManagementReviewSummary | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [reportType, setReportType] = useState<RecallReportFormData['report_type']>('Recall Register');
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [recallNumber, setRecallNumber] = useState('');
  const [product, setProduct] = useState('All');
  const [batchNumber, setBatchNumber] = useState('');
  const [marketRegion, setMarketRegion] = useState('All');
  const [recallTypeFilter, setRecallTypeFilter] = useState('All');
  const [recallClassification, setRecallClassification] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [regulatoryRequired, setRegulatoryRequired] = useState('All');
  const [capaRequired, setCapaRequired] = useState('All');

  const [analytics, setAnalytics] = useState<RecallReportAnalyticsResult | null>(null);
  const [savedReport, setSavedReport] = useState<RecallReportRecord | null>(null);
  const [showPdf, setShowPdf] = useState(false);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || 'System',
    role: role || '',
  }), [user?.uid, profile?.full_name, role]);

  const allowedReportTypes = useMemo(
    () => RECALL_REPORT_TYPES.filter((t) => canGenerateRecallReportTypeModule(role, t)),
    [role],
  );

  const formData = useMemo((): RecallReportFormData => ({
    report_type: reportType,
    review_period_from: periodFrom,
    review_period_to: periodTo,
    recall_number: recallNumber,
    product,
    batch_number: batchNumber,
    market_region: marketRegion,
    recall_type: recallTypeFilter,
    recall_classification: recallClassification,
    status: statusFilter,
    regulatory_notification_required: regulatoryRequired,
    capa_required: capaRequired,
  }), [reportType, periodFrom, periodTo, recallNumber, product, batchNumber, marketRegion, recallTypeFilter, recallClassification, statusFilter, regulatoryRequired, capaRequired]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods, mkts, dash, exports] = await Promise.all([
        fetchRecallReportRecords(),
        fetchRecallReportProductOptions(),
        fetchRecallReportMarketOptions(),
        fetchRecallDashboardAnalytics(),
        fetchRecallExportHistory(),
      ]);
      setHistory(rows);
      setProducts(prods);
      setMarkets(mkts);
      setDashboardMetrics(dash.metrics);
      setDashboardCharts(dash.charts);
      setManagementReview(dash.managementReview);
      setExportHistory(exports);
    } catch {
      setError('Failed to load recall reports and analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!user?.uid) return;
    void logRecallReportsModuleViewed(actor);
  }, [user?.uid, actor]);

  const runPreview = async () => {
    if (!canGenerateRecallReportTypeModule(role, reportType)) {
      toast.error('Your role cannot generate this report type');
      return;
    }
    const parsed = recallReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid report parameters');
      return;
    }
    setPreviewing(true);
    try {
      const result = await previewRecallReport({
        report_type: parsed.data.report_type,
        review_period_from: parsed.data.review_period_from,
        review_period_to: parsed.data.review_period_to,
        recall_number: parsed.data.recall_number,
        product: parsed.data.product,
        batch_number: parsed.data.batch_number,
        market_region: parsed.data.market_region,
        recall_type: parsed.data.recall_type,
        recall_classification: parsed.data.recall_classification,
        status: parsed.data.status,
        regulatory_notification_required: parsed.data.regulatory_notification_required,
        capa_required: parsed.data.capa_required,
      }, role, actor.id);
      setAnalytics(result);
      setStep(3);
      await logRecallReportPreviewed(actor, parsed.data.report_type, result.filtered_count);
      toast.message(result.filtered_count === 0 ? 'No records — empty preview shown' : `Preview: ${result.filtered_count} record(s)`);
    } catch {
      toast.error('Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const saveReport = async () => {
    if (!canGenerateRecallReportTypeModule(role, reportType) || readOnly) {
      toast.error('No permission to generate reports');
      return;
    }
    if (!analytics) {
      toast.error('Preview a report first');
      return;
    }
    const parsed = recallReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
      return;
    }
    setSaving(true);
    const { record, error: err } = await generateRecallReport(parsed.data, actor, history.length);
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
    if (!canExport) return toast.error('No export permission');
    if (!analytics && !savedReport) return toast.error('Generate or preview a report first');

    const report = savedReport || {
      id: 'preview',
      report_id: 'preview',
      report_name: reportType,
      report_number: `PREVIEW-${Date.now()}`,
      report_type: reportType,
      review_period_from: periodFrom,
      review_period_to: periodTo,
      recall_number: recallNumber,
      product,
      batch_number: batchNumber,
      market_region: marketRegion,
      recall_type_filter: recallTypeFilter,
      recall_classification: recallClassification,
      status_filter: statusFilter,
      regulatory_notification_required: regulatoryRequired,
      capa_required: capaRequired,
      generated_by: actor.id,
      generated_by_name: actor.name,
      generated_at: new Date().toISOString(),
      generated_date: new Date().toISOString().split('T')[0],
      total_records: analytics?.filtered_count ?? 0,
      export_type: type,
      file_url: '',
      report_status: 'Generated',
      filters_applied: {},
      summary: analytics?.summary || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_deleted: false,
    } as RecallReportRecord;

    try {
      await exportRecallReport(report, type, actor);
      if (savedReport) await logRecallReportDownloaded(actor, savedReport.id, savedReport.report_number);
      if (type === 'PDF') {
        setShowPdf(true);
        await logRecallReportPrinted(actor, report.id, report.report_number);
      }
      toast.success(`${type} export requested via backend`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Recall report export is not available.');
    }
  };

  const historyColumns = useMemo(() => [
    { key: 'report_number', header: 'Report No', render: (r: RecallReportRecord) => <span className="font-mono text-blue-600">{r.report_number}</span> },
    { key: 'report_type', header: 'Type' },
    { key: 'period', header: 'Period', render: (r: RecallReportRecord) => `${r.review_period_from} → ${r.review_period_to}` },
    { key: 'total', header: 'Records', render: (r: RecallReportRecord) => r.total_records },
    { key: 'status', header: 'Status', render: (r: RecallReportRecord) => <ReportStatusBadge status={r.report_status} /> },
    { key: 'export', header: 'Export', render: (r: RecallReportRecord) => r.export_type || '—' },
    { key: 'generated', header: 'Generated', render: (r: RecallReportRecord) => r.generated_date },
    {
      key: 'actions',
      header: '',
      render: (r: RecallReportRecord) => canExport ? (
        <Button variant="ghost" size="sm" onClick={() => void logRecallReportDownloaded(actor, r.id, r.report_number).then(() => toast.success('Download request logged'))}>
          <Download className="h-4 w-4" />
        </Button>
      ) : null,
    },
  ], [canExport, actor]);

  const previewTableData = useMemo(
    () => (analytics?.previewRows ?? []).map((row, i) => ({ id: row.recall_number || String(i), ...row })),
    [analytics?.previewRows],
  );

  const previewTableColumns = RECALL_PREVIEW_COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    render: (r: RecallReportPreviewRow & { id?: string }) => String(r[c.key as keyof RecallReportPreviewRow] ?? '—'),
  }));

  return (
    <RecallReportsAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Recall Reports & Analytics"
          description="Generate recall reports, recovery analytics and regulatory summaries"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/recall' },
            { label: 'Product Recall', href: '/qms/recall' },
            { label: 'Reports & Analytics' },
          ]}
          actions={canGenerate && !readOnly ? (
            <Button onClick={() => { setWizardOpen(true); setStep(0); setAnalytics(null); setSavedReport(null); }}>
              <FileText className="mr-2 h-4 w-4" /> Generate Report
            </Button>
          ) : undefined}
        />

        {loading ? <LoadingSkeleton rows={3} /> : error ? (
          <ErrorCard title="Load error" message={error} onRetry={load} />
        ) : (
          <Tabs defaultValue={defaultTab}>
            <TabsList className="flex h-auto flex-wrap gap-1">
              <TabsTrigger value="generator">Report Generator</TabsTrigger>
              <TabsTrigger value="analytics">Analytics Dashboard</TabsTrigger>
              <TabsTrigger value="saved">Saved Reports ({history.length})</TabsTrigger>
              {canManagement && <TabsTrigger value="management" onClick={() => void logManagementReportViewed(actor)}>Management Summary</TabsTrigger>}
              <TabsTrigger value="exports">Export History ({exportHistory.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="generator" className="mt-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Report Generation Wizard</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Launch the wizard to select report type, apply filters, preview recall data, and export GMP-compliant reports.
                  </p>
                  {canGenerate && !readOnly ? (
                    <Button onClick={() => { setWizardOpen(true); setStep(0); }}>
                      <FileText className="mr-2 h-4 w-4" /> Open Report Wizard
                    </Button>
                  ) : (
                    <p className="text-sm text-amber-700">Read-only access — export available where permitted.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analytics" className="mt-4 space-y-6">
              {dashboardMetrics && dashboardCharts ? (
                <>
                  <RecallReportsAnalyticsKpis metrics={dashboardMetrics} />
                  <RecallReportsCharts charts={dashboardCharts} />
                </>
              ) : (
                <EmptyState title="No analytics data" message="Recall records will populate analytics when available." />
              )}
            </TabsContent>

            <TabsContent value="saved" className="mt-4">
              {history.length ? (
                <ResponsiveDataTable columns={historyColumns} data={history} mobileTitleKey="report_number" mobileSubtitleKey="report_type" pageSize={10} />
              ) : (
                <EmptyState title="No saved reports" message="Generate a recall report to build GMP-compliant report history." />
              )}
            </TabsContent>

            <TabsContent value="management" className="mt-4 space-y-4">
              {managementReview ? (
                <>
                  <Card>
                    <CardHeader><CardTitle className="text-base">Management Summary</CardTitle></CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      <p>{managementReview.narrative}</p>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <MiniStat label="Total Recalls" value={managementReview.totalRecalls} />
                        <MiniStat label="Open" value={managementReview.openRecalls} />
                        <MiniStat label="Closed" value={managementReview.closedRecalls} />
                        <MiniStat label="Class I" value={managementReview.classIRecalls} />
                        <MiniStat label="Avg Recovery %" value={`${managementReview.avgRecoveryPercent}%`} />
                        <MiniStat label="Avg Closure Days" value={managementReview.avgClosureDays} />
                        <MiniStat label="Regulatory Pending" value={managementReview.regulatoryPending} />
                        <MiniStat label="Overdue" value={managementReview.overdueRecalls} />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="font-medium mb-2">Top Products</p>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {managementReview.topProducts.map((p) => <li key={p.name}>{p.name} ({p.count})</li>)}
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium mb-2">Top Markets</p>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {managementReview.topMarkets.map((m) => <li key={m.name}>{m.name} ({m.count})</li>)}
                          </ul>
                        </div>
                      </div>
                      <div>
                        <p className="font-medium mb-1">Recommendations</p>
                        <ul className="list-decimal pl-4 text-muted-foreground">
                          {managementReview.recommendations.map((o) => <li key={o}>{o}</li>)}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                  {dashboardMetrics && dashboardCharts && (
                    <RecallReportsCharts charts={dashboardCharts} compact />
                  )}
                </>
              ) : (
                <EmptyState title="No management data" message="Recall data required for management summary." />
              )}
            </TabsContent>

            <TabsContent value="exports" className="mt-4">
              {exportHistory.length ? (
                <ResponsiveDataTable columns={historyColumns} data={exportHistory} mobileTitleKey="report_number" mobileSubtitleKey="export_type" pageSize={10} />
              ) : (
                <EmptyState title="No export history" message="Exported reports will appear here with audit trail." />
              )}
            </TabsContent>
          </Tabs>
        )}

        <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Recall Report Generation Wizard</DialogTitle></DialogHeader>

            <div className="flex flex-wrap gap-1 mb-4">
              {WIZARD_STEPS.map((label, i) => (
                <div key={label} className={cn('flex items-center text-xs', i <= step ? 'text-blue-700 font-medium' : 'text-muted-foreground')}>
                  {i > 0 && <ChevronRight className="h-3 w-3 mx-1" />}{label}
                </div>
              ))}
            </div>

            {step === 0 && (
              <div className="space-y-4">
                <div><Label>Report Type *</Label>
                  <Select value={reportType} onValueChange={(v) => setReportType(v as RecallReportFormData['report_type'])} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{allowedReportTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <DialogFooter><Button onClick={() => setStep(1)}>Next</Button></DialogFooter>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Date From *</Label><Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} disabled={readOnly} /></div>
                <div><Label>Date To *</Label><Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} disabled={readOnly} /></div>
                <DialogFooter className="sm:col-span-2">
                  <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
                  <Button onClick={() => {
                    const parsed = recallReportFormSchema.safeParse({ ...formData, report_type: reportType });
                    if (!parsed.success) {
                      toast.error(parsed.error.errors.find((e) => e.path.includes('review_period'))?.message || parsed.error.errors[0]?.message || 'Invalid date range');
                      return;
                    }
                    setStep(2);
                  }}>Next</Button>
                </DialogFooter>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Recall Number</Label><Input value={recallNumber} onChange={(e) => setRecallNumber(e.target.value)} placeholder="Optional filter" disabled={readOnly} /></div>
                <div><Label>Product</Label>
                  <Select value={product} onValueChange={setProduct} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Batch Number</Label><Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} disabled={readOnly} /></div>
                <div><Label>Market / Region</Label>
                  <Select value={marketRegion} onValueChange={setMarketRegion} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{markets.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Recall Type</Label>
                  <Select value={recallTypeFilter} onValueChange={setRecallTypeFilter} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RECALL_REPORT_FILTER_OPTIONS.types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Recall Classification</Label>
                  <Select value={recallClassification} onValueChange={setRecallClassification} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RECALL_REPORT_FILTER_OPTIONS.classifications.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RECALL_REPORT_FILTER_OPTIONS.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Regulatory Notification Required</Label>
                  <Select value={regulatoryRequired} onValueChange={setRegulatoryRequired} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RECALL_REPORT_FILTER_OPTIONS.yesNoAll.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>CAPA Required</Label>
                  <Select value={capaRequired} onValueChange={setCapaRequired} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RECALL_REPORT_FILTER_OPTIONS.yesNoAll.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <DialogFooter className="sm:col-span-2">
                  <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                  <Button onClick={() => void runPreview()} disabled={previewing}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${previewing ? 'animate-spin' : ''}`} />Preview Report
                  </Button>
                </DialogFooter>
              </div>
            )}

            {step >= 3 && analytics && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Report Preview</CardTitle></CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-2">
                    <p>{analytics.summary}</p>
                    <p className="whitespace-pre-wrap">{analytics.recommendations}</p>
                  </CardContent>
                </Card>
                <RecallReportsAnalyticsKpis metrics={analytics.metrics} />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryCard title="Distribution" data={analytics.distributionSummary} />
                  <SummaryCard title="Recovery" data={analytics.recoverySummary} />
                  <SummaryCard title="Regulatory" data={analytics.regulatorySummary} />
                  <SummaryCard title="CAPA" data={analytics.capaSummary} />
                </div>
                {previewTableData.length ? (
                  <ResponsiveDataTable columns={previewTableColumns} data={previewTableData} mobileTitleKey="recall_number" mobileSubtitleKey="product_name" pageSize={8} />
                ) : (
                  <EmptyState title="Empty report" message="No recall records match filters — adjust criteria or export empty state report." />
                )}
                {step === 3 && <RecallReportsCharts charts={analytics.charts} compact />}
                <DialogFooter className="flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                  {canGenerate && !readOnly && canGenerateRecallReportTypeModule(role, reportType) && (
                    <Button onClick={() => void saveReport()} disabled={saving}>
                      <Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save Report'}
                    </Button>
                  )}
                  {canExport && (
                    <>
                      <Button variant="outline" onClick={() => void handleExport('PDF')}><Printer className="mr-2 h-4 w-4" />PDF</Button>
                      <Button variant="outline" onClick={() => void handleExport('Excel')}><FileSpreadsheet className="mr-2 h-4 w-4" />Excel</Button>
                      <Button variant="outline" onClick={() => void handleExport('CSV')}><Download className="mr-2 h-4 w-4" />CSV</Button>
                    </>
                  )}
                </DialogFooter>
              </div>
            )}

            {step === 4 && savedReport && (
              <div className="space-y-4">
                <p className="text-sm text-green-700">Report {savedReport.report_number} saved to history.</p>
                <DialogFooter><Button onClick={() => setWizardOpen(false)}>Close</Button></DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {showPdf && analytics && (
          <div className="fixed inset-0 -z-10 opacity-0 pointer-events-none print:relative print:z-50 print:opacity-100 print:pointer-events-auto">
            <RecallAggregateReportPdf
              reportNumber={savedReport?.report_number || `PREVIEW-${Date.now()}`}
              reportType={reportType}
              filters={formData}
              previewRows={analytics.previewRows}
              metrics={analytics.metrics}
              summary={analytics.summary}
              recommendations={analytics.recommendations}
              managementReview={analytics.managementReview}
              distributionSummary={analytics.distributionSummary}
              recoverySummary={analytics.recoverySummary}
              regulatorySummary={analytics.regulatorySummary}
              capaSummary={analytics.capaSummary}
              generatedBy={actor.name}
              generatedDate={new Date().toISOString().split('T')[0]}
            />
          </div>
        )}
      </div>
    </RecallReportsAccessGuard>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function SummaryCard({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null);
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title} Summary</CardTitle></CardHeader>
      <CardContent className="text-xs space-y-1 text-muted-foreground">
        {entries.length ? entries.map(([k, v]) => (
          <p key={k}><span className="font-medium text-foreground">{k.replace(/_/g, ' ')}:</span> {Array.isArray(v) ? v.join(', ') : String(v)}</p>
        )) : <p>No data</p>}
      </CardContent>
    </Card>
  );
}
