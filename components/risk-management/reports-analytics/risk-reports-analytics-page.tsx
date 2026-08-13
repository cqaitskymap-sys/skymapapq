'use client';

import { useMemo, useState } from 'react';
import {
  ChevronRight, Download, FileSpreadsheet, FileText, Printer, RefreshCw, Save, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { useRiskReports } from '@/hooks/use-risk-reports';
import {
  RISK_PREVIEW_COLUMNS,
  RISK_REPORT_FILTER_OPTIONS,
  RISK_REPORT_TYPES,
  canExportRiskReportType,
  canGenerateRiskReportType,
  reportStatusColor,
  riskReportFormSchema,
  type RiskReportAnalyticsResult,
  type RiskReportFormData,
  type RiskReportPreviewRow,
  type RiskReportRecord,
} from '@/lib/risk-reports-records';
import {
  exportRiskReport,
  generateRiskReport,
  logManagementReportViewed,
  logRiskReportPreviewed,
  logRiskReportPrinted,
  openRiskReportPdfHtml,
  previewRiskReport,
  scheduleRiskReport,
} from '@/lib/risk-reports-service';
import { printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { RiskReportsAccessGuard } from './risk-reports-access-guard';
import { RiskReportsAnalyticsKpis, RiskReportsCharts } from './risk-reports-charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type {
  RiskManagementReviewSummary,
  RiskReportAnalyticsMetrics,
  RiskReportChartData,
} from '@/lib/risk-reports-records';

interface RiskReportsAnalyticsPageProps {
  defaultTab?: 'generator' | 'dashboard' | 'saved' | 'management' | 'exports';
}

function buildFilterSummary(form: RiskReportFormData): string {
  const parts = [
    form.department !== 'All' ? `Dept: ${form.department}` : null,
    form.product !== 'All' ? `Product: ${form.product}` : null,
    form.risk_category !== 'All' ? `Category: ${form.risk_category}` : null,
    form.risk_level !== 'All' ? `Level: ${form.risk_level}` : null,
    form.risk_owner !== 'All' ? `Owner: ${form.risk_owner}` : null,
    form.status !== 'All' ? `Status: ${form.status}` : null,
    form.risk_number?.trim() ? `Risk: ${form.risk_number}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' | ') : 'All filters (default)';
}

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

export function RiskReportsAnalyticsPage({ defaultTab = 'generator' }: RiskReportsAnalyticsPageProps) {
  const {
    loading, error, history, exportHistory, products, owners,
    dashboardMetrics, dashboardCharts, managementReview, refresh,
    actor, role, canGenerate, canManagement, isReadOnly,
  } = useRiskReports();

  const [activeTab, setActiveTab] = useState(defaultTab);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const [reportType, setReportType] = useState<RiskReportFormData['report_type']>('Risk Register Report');
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [riskNumber, setRiskNumber] = useState('');
  const [department, setDepartment] = useState('All');
  const [product, setProduct] = useState('All');
  const [riskCategory, setRiskCategory] = useState('All');
  const [riskLevel, setRiskLevel] = useState('All');
  const [riskOwner, setRiskOwner] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [mitigationStatus, setMitigationStatus] = useState('All');
  const [reviewStatus, setReviewStatus] = useState('All');
  const [scheduleFreq, setScheduleFreq] = useState('monthly');

  const [analytics, setAnalytics] = useState<RiskReportAnalyticsResult | null>(null);
  const [savedReport, setSavedReport] = useState<RiskReportRecord | null>(null);

  const readOnly = isReadOnly;
  const canExportCurrent = canExportRiskReportType(role, reportType);

  const allowedReportTypes = useMemo(
    () => RISK_REPORT_TYPES.filter((t) => canGenerateRiskReportType(role, t)),
    [role],
  );

  const formData = useMemo((): RiskReportFormData => ({
    report_type: reportType,
    review_period_from: periodFrom,
    review_period_to: periodTo,
    risk_number: riskNumber,
    department,
    product,
    risk_category: riskCategory,
    risk_level: riskLevel,
    risk_owner: riskOwner,
    status: statusFilter,
    mitigation_status: mitigationStatus,
    review_status: reviewStatus,
  }), [reportType, periodFrom, periodTo, riskNumber, department, product, riskCategory, riskLevel, riskOwner, statusFilter, mitigationStatus, reviewStatus]);

  const runPreview = async () => {
    if (!canGenerateRiskReportType(role, reportType)) {
      toast.error('Your role cannot generate this report type');
      return;
    }
    const parsed = riskReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid report parameters');
      return;
    }
    setPreviewing(true);
    try {
      const result = await previewRiskReport({
        report_type: parsed.data.report_type,
        review_period_from: parsed.data.review_period_from,
        review_period_to: parsed.data.review_period_to,
        risk_number: parsed.data.risk_number,
        department: parsed.data.department,
        product: parsed.data.product,
        risk_category: parsed.data.risk_category,
        risk_level: parsed.data.risk_level,
        risk_owner: parsed.data.risk_owner,
        status: parsed.data.status,
        mitigation_status: parsed.data.mitigation_status,
        review_status: parsed.data.review_status,
      });
      setAnalytics(result);
      setStep(3);
      await logRiskReportPreviewed(actor, parsed.data.report_type, result.filtered_count);
      toast.message(result.filtered_count === 0 ? 'No records — empty preview shown' : `Preview: ${result.filtered_count} record(s)`);
    } catch {
      toast.error('Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const saveReport = async () => {
    if (!canGenerateRiskReportType(role, reportType) || readOnly) {
      toast.error('No permission to generate reports');
      return;
    }
    if (!analytics) {
      toast.error('Preview a report first');
      return;
    }
    const parsed = riskReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
      return;
    }
    setSaving(true);
    const { record, error: err } = await generateRiskReport(parsed.data, actor, history.length);
    setSaving(false);
    if (err || !record) toast.error(err || 'Save failed');
    else {
      setSavedReport(record);
      setStep(4);
      toast.success(`Report ${record.report_number} saved`);
      await refresh();
    }
  };

  const runSchedule = async () => {
    if (!canGenerate || readOnly) return toast.error('No permission');
    const parsed = riskReportFormSchema.safeParse(formData);
    if (!parsed.success) return toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
    setScheduling(true);
    const { error: err } = await scheduleRiskReport(parsed.data, actor, scheduleFreq);
    setScheduling(false);
    if (err) toast.error(err);
    else {
      toast.success('Report scheduled — owner notified');
      await refresh();
    }
  };

  const buildPreviewReport = (): RiskReportRecord => savedReport || {
    id: 'preview',
    report_id: 'preview',
    report_name: reportType,
    report_number: `PREVIEW-${Date.now()}`,
    report_type: reportType,
    review_period_from: periodFrom,
    review_period_to: periodTo,
    department,
    product,
    risk_category: riskCategory,
    risk_level: riskLevel,
    risk_owner: riskOwner,
    status_filter: statusFilter,
    mitigation_status: mitigationStatus,
    review_status: reviewStatus,
    risk_number: riskNumber,
    generated_by: actor.id,
    generated_by_name: actor.name,
    generated_at: new Date().toISOString(),
    total_records: analytics?.filtered_count ?? 0,
    report_status: 'Generated',
    preview_rows: analytics?.previewRows ?? [],
    chart_snapshot: analytics?.charts ?? {} as RiskReportChartData,
    metrics_snapshot: analytics?.metrics ?? {} as RiskReportAnalyticsMetrics,
    summary: analytics?.summary || '',
    recommendations: analytics?.recommendations || '',
    management_review: analytics?.managementReview ?? {} as RiskManagementReviewSummary,
    filters: { report_type: reportType, review_period_from: periodFrom, review_period_to: periodTo },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_deleted: false,
  };

  const validateDates = (): boolean => {
    const parsed = riskReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid date range');
      return false;
    }
    return true;
  };

  const handleExport = async (type: 'PDF' | 'Excel' | 'CSV') => {
    if (!canExportRiskReportType(role, reportType)) return toast.error('No export permission for this report type');
    if (!analytics && !savedReport) return toast.error('Generate or preview a report first');
    const report = buildPreviewReport();

    try {
      await exportRiskReport(report, type, actor);
      if (type === 'PDF') {
        await logRiskReportPrinted(actor, report.id || 'preview', report.report_number);
      }
      toast.success(`${type} export requested via backend`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Risk report export is not available.');
    }
  };

  const previewColumns = useMemo(() => RISK_PREVIEW_COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    render: (r: { id?: string } & RiskReportPreviewRow) => {
      if (c.key === 'risk_number') return <span className="font-mono text-blue-600">{r.risk_number}</span>;
      if (c.key === 'risk_level') return <span className="font-medium">{r.risk_level}</span>;
      return String(r[c.key as keyof RiskReportPreviewRow] ?? '—');
    },
  })), []);

  const historyColumns = useMemo(() => [
    { key: 'report_number', header: 'Report No', render: (r: RiskReportRecord) => <span className="font-mono text-blue-600">{r.report_number}</span> },
    { key: 'report_type', header: 'Type' },
    { key: 'period', header: 'Period', render: (r: RiskReportRecord) => `${r.review_period_from} → ${r.review_period_to}` },
    { key: 'total', header: 'Records', render: (r: RiskReportRecord) => r.total_records },
    { key: 'status', header: 'Status', render: (r: RiskReportRecord) => <ReportStatusBadge status={r.report_status} /> },
    { key: 'export', header: 'Export', render: (r: RiskReportRecord) => r.export_type || '—' },
    { key: 'generated', header: 'Generated', render: (r: RiskReportRecord) => r.generated_at?.split('T')[0] || '—' },
  ], []);

  const openWizard = () => {
    setWizardOpen(true);
    setStep(0);
    setAnalytics(null);
    setSavedReport(null);
  };

  return (
    <RiskReportsAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Risk Reports & Analytics"
          description="Generate risk intelligence, trends and management insights"
          trail={[
            { label: 'QMS', href: '/qms/risk-management' },
            { label: 'Risk Management', href: '/qms/risk-management' },
            { label: 'Reports & Analytics' },
          ]}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />Refresh
              </Button>
              {canGenerate && !readOnly && (
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={openWizard}>
                  <FileText className="h-4 w-4 mr-1" />Generate Report
                </Button>
              )}
            </div>
          )}
        />

        {readOnly && (
          <Alert>
            <AlertTitle>Read-only access</AlertTitle>
            <AlertDescription>Auditor view — report generation and export are disabled.</AlertDescription>
          </Alert>
        )}

        {loading ? <LoadingSkeleton rows={3} /> : error ? (
          <ErrorCard title="Load error" message={error} onRetry={refresh} />
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="flex h-auto flex-wrap gap-1">
              <TabsTrigger value="generator">Report Generator</TabsTrigger>
              <TabsTrigger value="dashboard">Analytics Dashboard</TabsTrigger>
              <TabsTrigger value="saved">Saved Reports ({history.length})</TabsTrigger>
              {canManagement && <TabsTrigger value="management" onClick={() => void logManagementReportViewed(actor)}>Management Review</TabsTrigger>}
              <TabsTrigger value="exports">Export History ({exportHistory.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="generator" className="mt-4 space-y-4">
              <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle>Report Generation Wizard</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Generate ICH Q9 compliant risk reports with FMEA, mitigation, residual risk and management review summaries.
                  </p>
                  {canGenerate && !readOnly ? (
                    <Button onClick={openWizard}>Open Report Wizard</Button>
                  ) : (
                    <p className="text-sm text-amber-700">Report generation requires QA or Risk Manager role.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="dashboard" className="mt-4 space-y-4">
              {dashboardMetrics && <RiskReportsAnalyticsKpis metrics={dashboardMetrics} />}
              {dashboardCharts && <RiskReportsCharts charts={dashboardCharts} />}
              {!dashboardMetrics && <EmptyState title="No analytics" message="No risk assessment data available." />}
            </TabsContent>

            <TabsContent value="saved" className="mt-4">
              {history.length ? (
                <ResponsiveDataTable columns={historyColumns} data={history} pageSize={10} mobileTitleKey="report_number" mobileSubtitleKey="report_type" />
              ) : (
                <EmptyState title="No saved reports" message="Generated reports appear here with soft-delete support." />
              )}
            </TabsContent>

            <TabsContent value="management" className="mt-4 space-y-4">
              {managementReview ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Identified</p><p className="text-2xl font-bold">{managementReview.totalRisksIdentified}</p></CardContent></Card>
                    <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Closed</p><p className="text-2xl font-bold">{managementReview.totalRisksClosed}</p></CardContent></Card>
                    <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Critical Risks</p><p className="text-2xl font-bold text-red-600">{managementReview.criticalRisks}</p></CardContent></Card>
                    <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Risk Reduction %</p><p className="text-2xl font-bold">{managementReview.riskReductionPercent}%</p></CardContent></Card>
                  </div>
                  <Card>
                    <CardHeader><CardTitle>Management Review Summary</CardTitle></CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p>{managementReview.narrative}</p>
                      <div>
                        <p className="font-semibold">Top Risk Categories</p>
                        <ul className="list-disc pl-5">{managementReview.topRiskCategories.map((c) => <li key={c.name}>{c.name} ({c.count})</li>)}</ul>
                      </div>
                      <div>
                        <p className="font-semibold">Top Departments</p>
                        <ul className="list-disc pl-5">{managementReview.topDepartments.map((d) => <li key={d.name}>{d.name} ({d.count})</li>)}</ul>
                      </div>
                      <div>
                        <p className="font-semibold">Improvement Opportunities</p>
                        <ul className="list-disc pl-5">{managementReview.improvementOpportunities.map((t) => <li key={t}>{t}</li>)}</ul>
                      </div>
                      <div>
                        <p className="font-semibold">Recommended Actions</p>
                        <ul className="list-disc pl-5">{managementReview.recommendedActions.map((t) => <li key={t}>{t}</li>)}</ul>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <EmptyState title="No management data" message="Risk data required for management review summary." />
              )}
            </TabsContent>

            <TabsContent value="exports" className="mt-4">
              {exportHistory.length ? (
                <ResponsiveDataTable columns={historyColumns} data={exportHistory} pageSize={10} mobileTitleKey="report_number" mobileSubtitleKey="export_type" />
              ) : (
                <EmptyState title="No export history" message="PDF, Excel and CSV exports are logged here." />
              )}
            </TabsContent>
          </Tabs>
        )}

        <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Report Wizard — {WIZARD_STEPS[step]}</DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap gap-1 mb-4">
              {WIZARD_STEPS.map((s, i) => (
                <span key={s} className={cn('text-xs px-2 py-1 rounded', i === step ? 'bg-blue-100 text-blue-800 font-medium' : 'text-muted-foreground')}>
                  {i + 1}. {s}
                </span>
              ))}
            </div>

            {step === 0 && (
              <div className="space-y-2">
                <Label>Report Type *</Label>
                <Select value={reportType} onValueChange={(v) => setReportType(v as RiskReportFormData['report_type'])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allowedReportTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label>From Date *</Label><Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} /></div>
                <div className="space-y-1"><Label>To Date *</Label><Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} /></div>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label>Risk Number</Label><Input value={riskNumber} onChange={(e) => setRiskNumber(e.target.value)} placeholder="RISK/..." /></div>
                <div className="space-y-1"><Label>Department</Label>
                  <Select value={department} onValueChange={setDepartment}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RISK_REPORT_FILTER_OPTIONS.departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label>Product</Label>
                  <Select value={product} onValueChange={setProduct}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label>Risk Category</Label>
                  <Select value={riskCategory} onValueChange={setRiskCategory}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RISK_REPORT_FILTER_OPTIONS.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label>Risk Level</Label>
                  <Select value={riskLevel} onValueChange={setRiskLevel}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RISK_REPORT_FILTER_OPTIONS.levels.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label>Risk Owner</Label>
                  <Select value={riskOwner} onValueChange={setRiskOwner}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RISK_REPORT_FILTER_OPTIONS.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label>Mitigation Status</Label>
                  <Select value={mitigationStatus} onValueChange={setMitigationStatus}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RISK_REPORT_FILTER_OPTIONS.mitigationStatuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label>Review Status</Label>
                  <Select value={reviewStatus} onValueChange={setReviewStatus}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RISK_REPORT_FILTER_OPTIONS.reviewStatuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
                </div>
              </div>
            )}

            {step === 3 && analytics && (
              <div className="space-y-4">
                <p className="text-sm">{analytics.summary}</p>
                <RiskReportsAnalyticsKpis metrics={analytics.metrics} />
                {analytics.filtered_count === 0 ? (
                  <EmptyState title="No data found" message="No risk records match the selected filters and date range." />
                ) : (
                  <>
                    <RiskReportsCharts charts={analytics.charts} compact />
                    <ResponsiveDataTable
                      columns={previewColumns}
                      data={analytics.previewRows.slice(0, 20).map((r, i) => ({ ...r, id: r.risk_number || String(i) }))}
                      pageSize={10}
                      mobileTitleKey="risk_number"
                      mobileSubtitleKey="product"
                    />
                  </>
                )}
              </div>
            )}

            {step === 4 && savedReport && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-green-700">Report {savedReport.report_number} saved to history.</p>
                <div className="flex flex-wrap gap-2">
                  {canExportCurrent && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => void handleExport('PDF')}><FileText className="h-4 w-4 mr-1" />PDF</Button>
                      <Button variant="outline" size="sm" onClick={() => void handleExport('Excel')}><FileSpreadsheet className="h-4 w-4 mr-1" />Excel</Button>
                      <Button variant="outline" size="sm" onClick={() => void handleExport('CSV')}><Download className="h-4 w-4 mr-1" />CSV</Button>
                      <Button variant="outline" size="sm" onClick={() => { openRiskReportPdfHtml(savedReport, actor.name, buildFilterSummary(formData)); printPage(); void logRiskReportPrinted(actor, savedReport.id || 'preview', savedReport.report_number); }}><Printer className="h-4 w-4 mr-1" />Print</Button>
                    </>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Schedule Report</Label>
                  <div className="flex gap-2">
                    <Select value={scheduleFreq} onValueChange={setScheduleFreq}>
                      <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="outline" disabled={scheduling} onClick={() => void runSchedule()}>
                      <Calendar className="h-4 w-4 mr-1" />{scheduling ? 'Scheduling…' : 'Schedule'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="flex-wrap gap-2">
              {step > 0 && <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button>}
              {step < 1 && <Button onClick={() => setStep((s) => s + 1)}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>}
              {step === 1 && (
                <Button onClick={() => { if (validateDates()) setStep((s) => s + 1); }}>
                  Next<ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
              {step === 2 && (
                <Button onClick={() => void runPreview()} disabled={previewing}>
                  {previewing ? 'Previewing…' : 'Preview Report'}
                </Button>
              )}
              {step === 3 && canGenerate && !readOnly && (
                <Button onClick={() => void saveReport()} disabled={saving || !analytics}>
                  <Save className="h-4 w-4 mr-1" />{saving ? 'Saving…' : 'Save Report'}
                </Button>
              )}
              {step === 4 && <Button variant="outline" onClick={() => setWizardOpen(false)}>Close</Button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </RiskReportsAccessGuard>
  );
}
