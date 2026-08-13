'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, Download, FileSpreadsheet, FileText, Printer, RefreshCw, Save, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  CC_PREVIEW_COLUMNS,
  CC_REPORT_FILTER_OPTIONS,
  CC_REPORT_TYPES,
  canExportCcReports,
  canGenerateCcReportType,
  canGenerateCcReports,
  canViewManagementReview,
  ccReportFormSchema,
  isCcReportsReadOnly,
  reportStatusColor,
  type CcReportAnalyticsResult,
  type CcReportFormData,
} from '@/lib/cc-reports-records';
import {
  exportCcReport,
  fetchCcDashboardAnalytics,
  fetchCcExportHistory,
  fetchCcReportOwnerOptions,
  fetchCcReportProductOptions,
  fetchCcReportRecords,
  generateCcReport,
  logCcReportDownloaded,
  logCcReportPreviewed,
  logCcReportPrinted,
  logManagementReportViewed,
  previewCcReport,
  scheduleCcReport,
} from '@/lib/cc-reports-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { CcReportsAccessGuard } from './cc-reports-access-guard';
import { CcReportsAnalyticsKpis, CcReportsCharts } from './cc-reports-charts';
import { CcAggregateReportPdf } from './cc-aggregate-report-pdf';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type {
  CcManagementReviewSummary,
  CcReportAnalyticsMetrics,
  CcReportChartData,
  CcReportPreviewRow,
  CcReportRecord,
} from '@/lib/change-control-types';

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

export function CcReportsAnalyticsPage() {
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canGenerate = canGenerateCcReports(role);
  const canExport = canExportCcReports(role);
  const canManagement = canViewManagementReview(role);
  const readOnly = isCcReportsReadOnly(role);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CcReportRecord[]>([]);
  const [exportHistory, setExportHistory] = useState<CcReportRecord[]>([]);
  const [products, setProducts] = useState<string[]>(['All']);
  const [owners, setOwners] = useState<string[]>(['All']);
  const [dashboardMetrics, setDashboardMetrics] = useState<CcReportAnalyticsMetrics | null>(null);
  const [dashboardCharts, setDashboardCharts] = useState<CcReportChartData | null>(null);
  const [managementReview, setManagementReview] = useState<CcManagementReviewSummary | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const [reportType, setReportType] = useState<CcReportFormData['report_type']>('Change Control Register');
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [changeNumber, setChangeNumber] = useState('');
  const [department, setDepartment] = useState('All');
  const [product, setProduct] = useState('All');
  const [changeType, setChangeType] = useState('All');
  const [category, setCategory] = useState('All');
  const [priority, setPriority] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [validationImpact, setValidationImpact] = useState(false);
  const [csvImpact, setCsvImpact] = useState(false);
  const [trainingImpact, setTrainingImpact] = useState(false);
  const [regulatoryImpact, setRegulatoryImpact] = useState(false);
  const [owner, setOwner] = useState('All');
  const [scheduleFreq, setScheduleFreq] = useState('monthly');

  const [analytics, setAnalytics] = useState<CcReportAnalyticsResult | null>(null);
  const [savedReport, setSavedReport] = useState<CcReportRecord | null>(null);
  const [showPdf, setShowPdf] = useState(false);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || 'System',
    role: role || '',
  }), [user?.uid, profile?.full_name, role]);

  const allowedReportTypes = useMemo(
    () => CC_REPORT_TYPES.filter((t) => canGenerateCcReportType(role, t)),
    [role],
  );

  const formData = useMemo((): CcReportFormData => ({
    report_type: reportType,
    review_period_from: periodFrom,
    review_period_to: periodTo,
    change_number: changeNumber,
    department,
    product,
    change_type: changeType,
    category,
    priority,
    status: statusFilter,
    validation_impact: validationImpact,
    csv_impact: csvImpact,
    training_impact: trainingImpact,
    regulatory_impact: regulatoryImpact,
    owner,
  }), [reportType, periodFrom, periodTo, changeNumber, department, product, changeType, category, priority, statusFilter, validationImpact, csvImpact, trainingImpact, regulatoryImpact, owner]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods, ownerOpts, dash, exports] = await Promise.all([
        fetchCcReportRecords(),
        fetchCcReportProductOptions(),
        fetchCcReportOwnerOptions(),
        fetchCcDashboardAnalytics(),
        fetchCcExportHistory(),
      ]);
      setHistory(rows);
      setProducts(prods);
      setOwners(ownerOpts);
      setDashboardMetrics(dash.metrics);
      setDashboardCharts(dash.charts);
      setManagementReview(dash.managementReview);
      setExportHistory(exports);
    } catch {
      setError('Failed to load Change Control reports and analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runPreview = async () => {
    if (!canGenerateCcReportType(role, reportType)) {
      toast.error('Your role cannot generate this report type');
      return;
    }
    const parsed = ccReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid report parameters');
      return;
    }
    setPreviewing(true);
    try {
      const result = await previewCcReport({
        report_type: parsed.data.report_type,
        review_period_from: parsed.data.review_period_from,
        review_period_to: parsed.data.review_period_to,
        change_number: parsed.data.change_number,
        department: parsed.data.department,
        product: parsed.data.product,
        change_type: parsed.data.change_type,
        category: parsed.data.category,
        priority: parsed.data.priority,
        status: parsed.data.status,
        validation_impact: parsed.data.validation_impact,
        csv_impact: parsed.data.csv_impact,
        training_impact: parsed.data.training_impact,
        regulatory_impact: parsed.data.regulatory_impact,
        owner: parsed.data.owner,
      });
      setAnalytics(result);
      setStep(3);
      await logCcReportPreviewed(actor, parsed.data.report_type, result.filtered_count);
      toast.message(result.filtered_count === 0 ? 'No records — empty preview shown' : `Preview: ${result.filtered_count} record(s)`);
    } catch {
      toast.error('Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const saveReport = async () => {
    if (!canGenerateCcReportType(role, reportType) || readOnly) {
      toast.error('No permission to generate reports');
      return;
    }
    if (!analytics) {
      toast.error('Preview a report first');
      return;
    }
    const parsed = ccReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
      return;
    }
    setSaving(true);
    const { record, error: err } = await generateCcReport(parsed.data, actor, history.length);
    setSaving(false);
    if (err || !record) toast.error(err || 'Save failed');
    else {
      setSavedReport(record);
      setStep(4);
      toast.success(`Report ${record.report_number} saved`);
      await load();
    }
  };

  const runSchedule = async () => {
    if (!canGenerate || readOnly) return toast.error('No permission');
    const parsed = ccReportFormSchema.safeParse(formData);
    if (!parsed.success) return toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
    setScheduling(true);
    const { id, error: err } = await scheduleCcReport(parsed.data, actor, scheduleFreq);
    setScheduling(false);
    if (err) toast.error(err);
    else {
      toast.success('Report scheduled');
      await load();
    }
    void id;
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
      change_number: changeNumber,
      department,
      product,
      change_type: changeType,
      category,
      priority,
      status_filter: statusFilter,
      validation_impact: validationImpact,
      csv_impact: csvImpact,
      training_impact: trainingImpact,
      regulatory_impact: regulatoryImpact,
      owner,
      generated_by: actor.id,
      generated_by_name: actor.name,
      generated_at: new Date().toISOString(),
      generated_date: new Date().toISOString().split('T')[0],
      total_records: analytics?.filtered_count ?? 0,
      export_type: type,
      file_url: '',
      report_status: 'Generated',
      filters_applied: {},
      preview_rows: [],
      chart_snapshot: {},
      metrics_snapshot: {},
      management_summary: analytics?.managementReview ?? {} as CcManagementReviewSummary,
      summary: analytics?.summary || '',
      recommendations: analytics?.recommendations || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_deleted: false,
    } as CcReportRecord;

    try {
      await exportCcReport(report, type, actor);
      if (savedReport) await logCcReportDownloaded(actor, savedReport.id, savedReport.report_number);

      if (type === 'PDF') {
        setShowPdf(true);
        await logCcReportPrinted(actor, report.id, report.report_number);
      }
      toast.success(`${type} export requested via backend`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Change control report export is not available.');
    }
  };

  const historyColumns = useMemo(() => [
    { key: 'report_number', header: 'Report No', render: (r: CcReportRecord) => <span className="font-mono text-blue-600">{r.report_number}</span> },
    { key: 'report_type', header: 'Type' },
    { key: 'period', header: 'Period', render: (r: CcReportRecord) => `${r.review_period_from} → ${r.review_period_to}` },
    { key: 'total', header: 'Records', render: (r: CcReportRecord) => r.total_records },
    { key: 'status', header: 'Status', render: (r: CcReportRecord) => <ReportStatusBadge status={r.report_status} /> },
    { key: 'export', header: 'Export', render: (r: CcReportRecord) => r.export_type || '—' },
    { key: 'generated', header: 'Generated', render: (r: CcReportRecord) => r.generated_date },
    {
      key: 'actions',
      header: '',
      render: (r: CcReportRecord) => canExport ? (
        <Button variant="ghost" size="sm" onClick={() => void logCcReportDownloaded(actor, r.id, r.report_number).then(() => toast.success('Download request logged'))}>
          <Download className="h-4 w-4" />
        </Button>
      ) : null,
    },
  ], [canExport, actor]);

  const previewTableData = useMemo(
    () => (analytics?.previewRows ?? []).map((row, i) => ({ id: row.change_number || String(i), ...row })),
    [analytics?.previewRows],
  );

  const previewTableColumns = CC_PREVIEW_COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    render: (r: CcReportPreviewRow & { id?: string }) => {
      const val = r[c.key as keyof CcReportPreviewRow];
      return String(val ?? '—');
    },
  }));

  return (
    <CcReportsAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Change Control Reports & Analytics"
          description="Generate change control reports, trends and management insights"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/change-control' },
            { label: 'Change Control', href: '/qms/change-control' },
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
          <Tabs defaultValue="generator">
            <TabsList className="flex h-auto flex-wrap gap-1">
              <TabsTrigger value="generator">Report Generator</TabsTrigger>
              <TabsTrigger value="analytics">Analytics Dashboard</TabsTrigger>
              <TabsTrigger value="saved">Saved Reports ({history.length})</TabsTrigger>
              {canManagement && <TabsTrigger value="management" onClick={() => void logManagementReportViewed(actor)}>Management Review</TabsTrigger>}
              <TabsTrigger value="exports">Export History ({exportHistory.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="generator" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Report Generation Wizard</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Launch the wizard to select report type, apply filters, preview data, and export GMP-compliant change control reports.
                  </p>
                  {canGenerate && !readOnly ? (
                    <Button onClick={() => { setWizardOpen(true); setStep(0); }}>
                      <FileText className="mr-2 h-4 w-4" /> Open Report Wizard
                    </Button>
                  ) : (
                    <p className="text-sm text-amber-700">Read-only access — viewing reports and analytics only.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analytics" className="mt-4 space-y-6">
              {dashboardMetrics && dashboardCharts ? (
                <>
                  <CcReportsAnalyticsKpis metrics={dashboardMetrics} />
                  <CcReportsCharts charts={dashboardCharts} />
                </>
              ) : (
                <EmptyState title="No analytics data" message="Change control records will populate analytics when available." />
              )}
            </TabsContent>

            <TabsContent value="saved" className="mt-4">
              {history.length ? (
                <ResponsiveDataTable columns={historyColumns} data={history} mobileTitleKey="report_number" mobileSubtitleKey="report_type" pageSize={10} />
              ) : (
                <EmptyState title="No saved reports" message="Generate a change control report to build GMP-compliant report history." />
              )}
            </TabsContent>

            <TabsContent value="management" className="mt-4 space-y-4">
              {managementReview ? (
                <>
                  <Card>
                    <CardHeader><CardTitle className="text-base">Management Review Summary</CardTitle></CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      <p>{managementReview.narrative}</p>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <MiniStat label="Total Initiated" value={managementReview.totalChangesInitiated} />
                        <MiniStat label="Total Closed" value={managementReview.totalChangesClosed} />
                        <MiniStat label="Closure Rate" value={dashboardMetrics ? `${dashboardMetrics.closureRate}%` : '—'} />
                        <MiniStat label="Overdue %" value={`${managementReview.overdueChangePct}%`} />
                        <MiniStat label="Validation Impact %" value={`${managementReview.validationImpactPct}%`} />
                        <MiniStat label="CSV Impact %" value={`${managementReview.csvImpactPct}%`} />
                        <MiniStat label="Training Impact %" value={`${managementReview.trainingImpactPct}%`} />
                        <MiniStat label="Implementation Success %" value={dashboardMetrics ? `${dashboardMetrics.implementationSuccessRate}%` : '—'} />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="font-medium mb-2">Top Change Types</p>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {managementReview.topChangeTypes.map((r) => <li key={r.name}>{r.name} ({r.count})</li>)}
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium mb-2">Top Departments</p>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {managementReview.topDepartments.map((d) => <li key={d.name}>{d.name} ({d.count})</li>)}
                          </ul>
                        </div>
                      </div>
                      <div>
                        <p className="font-medium mb-1">Critical Changes</p>
                        <p className="text-muted-foreground">{managementReview.criticalChanges}</p>
                      </div>
                      <div>
                        <p className="font-medium mb-1">Improvement Opportunities</p>
                        <ul className="list-decimal pl-4 text-muted-foreground">
                          {managementReview.improvementOpportunities.map((o) => <li key={o}>{o}</li>)}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                  {dashboardMetrics && dashboardCharts && (
                    <CcReportsCharts charts={dashboardCharts} compact />
                  )}
                </>
              ) : (
                <EmptyState title="No management data" message="Change control data required for management review summary." />
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
            <DialogHeader><DialogTitle>Change Control Report Generation Wizard</DialogTitle></DialogHeader>

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
                  <Select value={reportType} onValueChange={(v) => setReportType(v as CcReportFormData['report_type'])} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{allowedReportTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <DialogFooter><Button onClick={() => setStep(1)}>Next</Button></DialogFooter>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Review From *</Label><Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} disabled={readOnly} /></div>
                <div><Label>Review To *</Label><Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} disabled={readOnly} /></div>
                <DialogFooter className="sm:col-span-2">
                  <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
                  <Button onClick={() => setStep(2)}>Next</Button>
                </DialogFooter>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div><Label>Change Number</Label><Input value={changeNumber} onChange={(e) => setChangeNumber(e.target.value)} placeholder="Optional filter" disabled={readOnly} /></div>
                <div><Label>Department</Label>
                  <Select value={department} onValueChange={setDepartment} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CC_REPORT_FILTER_OPTIONS.departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Product</Label>
                  <Select value={product} onValueChange={setProduct} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Change Type</Label>
                  <Select value={changeType} onValueChange={setChangeType} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CC_REPORT_FILTER_OPTIONS.changeTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Category</Label>
                  <Select value={category} onValueChange={setCategory} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CC_REPORT_FILTER_OPTIONS.categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CC_REPORT_FILTER_OPTIONS.priorities.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CC_REPORT_FILTER_OPTIONS.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Owner</Label>
                  <Select value={owner} onValueChange={setOwner} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2"><Checkbox checked={validationImpact} onCheckedChange={(v) => setValidationImpact(Boolean(v))} disabled={readOnly} /><Label>Validation Impact</Label></div>
                <div className="flex items-center gap-2"><Checkbox checked={csvImpact} onCheckedChange={(v) => setCsvImpact(Boolean(v))} disabled={readOnly} /><Label>CSV Impact</Label></div>
                <div className="flex items-center gap-2"><Checkbox checked={trainingImpact} onCheckedChange={(v) => setTrainingImpact(Boolean(v))} disabled={readOnly} /><Label>Training Impact</Label></div>
                <div className="flex items-center gap-2"><Checkbox checked={regulatoryImpact} onCheckedChange={(v) => setRegulatoryImpact(Boolean(v))} disabled={readOnly} /><Label>Regulatory Impact</Label></div>
                <div className="sm:col-span-2">
                  <Label>Schedule Frequency (optional)</Label>
                  <Select value={scheduleFreq} onValueChange={setScheduleFreq} disabled={readOnly}>
                    <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
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
                <CcReportsAnalyticsKpis metrics={analytics.metrics} />
                {previewTableData.length ? (
                  <ResponsiveDataTable columns={previewTableColumns} data={previewTableData} mobileTitleKey="change_number" mobileSubtitleKey="department" pageSize={8} />
                ) : (
                  <EmptyState title="Empty report" message="No change records match filters — adjust criteria or save empty state report." />
                )}
                {step === 3 && <CcReportsCharts charts={analytics.charts} compact />}
                <DialogFooter className="flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                  {canGenerate && !readOnly && canGenerateCcReportType(role, reportType) && (
                    <>
                      <Button onClick={() => void saveReport()} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : 'Save Report'}</Button>
                      <Button variant="secondary" onClick={() => void runSchedule()} disabled={scheduling}>
                        <Calendar className="mr-2 h-4 w-4" />{scheduling ? 'Scheduling…' : 'Schedule'}
                      </Button>
                    </>
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
          <div className="hidden print:block">
            <CcAggregateReportPdf
              reportNumber={savedReport?.report_number || `PREVIEW-${Date.now()}`}
              reportType={reportType}
              filters={formData}
              previewRows={analytics.previewRows}
              metrics={analytics.metrics}
              summary={analytics.summary}
              recommendations={analytics.recommendations}
              managementReview={analytics.managementReview}
              generatedBy={actor.name}
              generatedDate={new Date().toISOString().split('T')[0]}
            />
          </div>
        )}
      </div>
    </CcReportsAccessGuard>
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
