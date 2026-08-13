'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, Download, FileSpreadsheet, FileText, Printer, RefreshCw, Save, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  CAPA_PREVIEW_COLUMNS,
  CAPA_REPORT_FILTER_OPTIONS,
  CAPA_REPORT_TYPES,
  canExportCapaReports,
  canGenerateCapaReportType,
  canGenerateCapaReports,
  canViewManagementReview,
  capaReportFormSchema,
  isCapaReportsReadOnly,
  reportStatusColor,
  type CapaReportAnalyticsResult,
  type CapaReportFormData,
} from '@/lib/capa-reports-records';
import {
  exportCapaReport,
  fetchCapaDashboardAnalytics,
  fetchCapaExportHistory,
  fetchCapaReportOwnerOptions,
  fetchCapaReportProductOptions,
  fetchCapaReportRecords,
  generateCapaReport,
  logCapaReportDownloaded,
  logCapaReportPreviewed,
  logCapaReportPrinted,
  logManagementReportViewed,
  previewCapaReport,
  scheduleCapaReport,
} from '@/lib/capa-reports-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { CapaReportsAccessGuard } from './capa-reports-access-guard';
import { CapaReportsAnalyticsKpis, CapaReportsCharts } from './capa-reports-charts';
import { CapaAggregateReportPdf } from './capa-aggregate-report-pdf';
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
import type { CapaManagementReviewSummary, CapaReportAnalyticsMetrics, CapaReportChartData, CapaReportPreviewRow, CapaReportRecord } from '@/lib/capa-types';

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

export function CapaReportsAnalyticsPage() {
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canGenerate = canGenerateCapaReports(role);
  const canExport = canExportCapaReports(role);
  const canManagement = canViewManagementReview(role);
  const readOnly = isCapaReportsReadOnly(role);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CapaReportRecord[]>([]);
  const [exportHistory, setExportHistory] = useState<CapaReportRecord[]>([]);
  const [products, setProducts] = useState<string[]>(['All']);
  const [owners, setOwners] = useState<string[]>(['All']);
  const [dashboardMetrics, setDashboardMetrics] = useState<CapaReportAnalyticsMetrics | null>(null);
  const [dashboardCharts, setDashboardCharts] = useState<CapaReportChartData | null>(null);
  const [managementReview, setManagementReview] = useState<CapaManagementReviewSummary | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const [reportType, setReportType] = useState<CapaReportFormData['report_type']>('CAPA Register');
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(defaultTo);
  const [capaNumber, setCapaNumber] = useState('');
  const [department, setDepartment] = useState('All');
  const [product, setProduct] = useState('All');
  const [capaSource, setCapaSource] = useState('All');
  const [priority, setPriority] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [effectiveness, setEffectiveness] = useState('All');
  const [owner, setOwner] = useState('All');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [scheduleFreq, setScheduleFreq] = useState('monthly');

  const [analytics, setAnalytics] = useState<CapaReportAnalyticsResult | null>(null);
  const [savedReport, setSavedReport] = useState<CapaReportRecord | null>(null);
  const [showPdf, setShowPdf] = useState(false);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || 'System',
    role: role || '',
  }), [user?.uid, profile?.full_name, role]);

  const allowedReportTypes = useMemo(
    () => CAPA_REPORT_TYPES.filter((t) => canGenerateCapaReportType(role, t)),
    [role],
  );

  const formData = useMemo((): CapaReportFormData => ({
    report_type: reportType,
    review_period_from: periodFrom,
    review_period_to: periodTo,
    capa_number: capaNumber,
    department,
    product,
    capa_source: capaSource,
    priority,
    status: statusFilter,
    effectiveness_result: effectiveness,
    owner,
    overdue_only: overdueOnly,
    critical_only: criticalOnly,
  }), [reportType, periodFrom, periodTo, capaNumber, department, product, capaSource, priority, statusFilter, effectiveness, owner, overdueOnly, criticalOnly]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods, ownerOpts, dash, exports] = await Promise.all([
        fetchCapaReportRecords(),
        fetchCapaReportProductOptions(),
        fetchCapaReportOwnerOptions(),
        fetchCapaDashboardAnalytics(),
        fetchCapaExportHistory(),
      ]);
      setHistory(rows);
      setProducts(prods);
      setOwners(ownerOpts);
      setDashboardMetrics(dash.metrics);
      setDashboardCharts(dash.charts);
      setManagementReview(dash.managementReview);
      setExportHistory(exports);
    } catch {
      setError('Failed to load CAPA reports and analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runPreview = async () => {
    if (!canGenerateCapaReportType(role, reportType)) {
      toast.error('Your role cannot generate this report type');
      return;
    }
    const parsed = capaReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid report parameters');
      return;
    }
    setPreviewing(true);
    try {
      const result = await previewCapaReport({
        report_type: parsed.data.report_type,
        review_period_from: parsed.data.review_period_from,
        review_period_to: parsed.data.review_period_to,
        capa_number: parsed.data.capa_number,
        department: parsed.data.department,
        product: parsed.data.product,
        capa_source: parsed.data.capa_source,
        priority: parsed.data.priority,
        status: parsed.data.status,
        effectiveness_result: parsed.data.effectiveness_result,
        owner: parsed.data.owner,
        overdue_only: parsed.data.overdue_only,
        critical_only: parsed.data.critical_only,
      });
      setAnalytics(result);
      setStep(3);
      await logCapaReportPreviewed(actor, parsed.data.report_type, result.filtered_count);
      toast.message(result.filtered_count === 0 ? 'No records — empty preview shown' : `Preview: ${result.filtered_count} record(s)`);
    } catch {
      toast.error('Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const saveReport = async () => {
    if (!canGenerateCapaReportType(role, reportType) || readOnly) {
      toast.error('No permission to generate reports');
      return;
    }
    if (!analytics) {
      toast.error('Preview a report first');
      return;
    }
    const parsed = capaReportFormSchema.safeParse(formData);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
      return;
    }
    setSaving(true);
    const { record, error: err } = await generateCapaReport(parsed.data, actor, history.length);
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
    const parsed = capaReportFormSchema.safeParse(formData);
    if (!parsed.success) return toast.error(parsed.error.errors[0]?.message || 'Invalid parameters');
    setScheduling(true);
    const { id, error: err } = await scheduleCapaReport(parsed.data, actor, scheduleFreq);
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
      department,
      product,
      capa_source: capaSource,
      priority,
      status_filter: statusFilter,
      effectiveness_result: effectiveness,
      capa_number: capaNumber,
      owner,
      overdue_only: overdueOnly,
      critical_only: criticalOnly,
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
    } as CapaReportRecord;

    try {
      await exportCapaReport(report, type, actor);
      if (savedReport) await logCapaReportDownloaded(actor, savedReport.id, savedReport.report_number);
      if (type === 'PDF') {
        setShowPdf(true);
        await logCapaReportPrinted(actor, report.id, report.report_number);
      }
      toast.success(`${type} export requested via backend`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'CAPA report export is not available.');
    }
  };

  const historyColumns = useMemo(() => [
    { key: 'report_number', header: 'Report No', render: (r: CapaReportRecord) => <span className="font-mono text-blue-600">{r.report_number}</span> },
    { key: 'report_type', header: 'Type' },
    { key: 'period', header: 'Period', render: (r: CapaReportRecord) => `${r.review_period_from} → ${r.review_period_to}` },
    { key: 'total', header: 'Records', render: (r: CapaReportRecord) => r.total_records },
    { key: 'status', header: 'Status', render: (r: CapaReportRecord) => <ReportStatusBadge status={r.report_status} /> },
    { key: 'export', header: 'Export', render: (r: CapaReportRecord) => r.export_type || '—' },
    { key: 'generated', header: 'Generated', render: (r: CapaReportRecord) => r.generated_date },
    {
      key: 'actions',
      header: '',
      render: (r: CapaReportRecord) => canExport ? (
        <Button variant="ghost" size="sm" onClick={() => void logCapaReportDownloaded(actor, r.id, r.report_number).then(() => toast.success('Download request logged'))}>
          <Download className="h-4 w-4" />
        </Button>
      ) : null,
    },
  ], [canExport, actor]);

  const previewTableData = useMemo(
    () => (analytics?.previewRows ?? []).map((row, i) => ({ id: row.capa_number || String(i), ...row })),
    [analytics?.previewRows],
  );

  const previewTableColumns = CAPA_PREVIEW_COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    render: (r: CapaReportPreviewRow & { id?: string }) => {
      const val = r[c.key as keyof CapaReportPreviewRow];
      return String(val ?? '—');
    },
  }));

  return (
    <CapaReportsAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="CAPA Reports & Analytics"
          description="Generate CAPA reports, trends and management insights"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/capa' },
            { label: 'CAPA Management', href: '/qms/capa' },
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
                    Launch the wizard to select report type, apply filters, preview data, and export GMP-compliant reports.
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
                  <CapaReportsAnalyticsKpis metrics={dashboardMetrics} />
                  <CapaReportsCharts charts={dashboardCharts} />
                </>
              ) : (
                <EmptyState title="No analytics data" message="CAPA records will populate analytics when available." />
              )}
            </TabsContent>

            <TabsContent value="saved" className="mt-4">
              {history.length ? (
                <ResponsiveDataTable columns={historyColumns} data={history} mobileTitleKey="report_number" mobileSubtitleKey="report_type" pageSize={10} />
              ) : (
                <EmptyState title="No saved reports" message="Generate a CAPA report to build GMP-compliant report history." />
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
                        <MiniStat label="Total Created" value={managementReview.totalCapaCreated} />
                        <MiniStat label="Total Closed" value={managementReview.totalCapaClosed} />
                        <MiniStat label="Overdue %" value={`${managementReview.overdueCapaPct}%`} />
                        <MiniStat label="Effectiveness %" value={`${managementReview.capaEffectivenessPct}%`} />
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="font-medium mb-2">Top Root Causes</p>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {managementReview.topRootCauses.map((r) => <li key={r.name}>{r.name} ({r.count})</li>)}
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium mb-2">Top Departments</p>
                          <ul className="list-disc pl-4 text-muted-foreground">
                            {managementReview.topDepartments.map((d) => <li key={d.name}>{d.name} ({d.count})</li>)}
                          </ul>
                        </div>
                      </div>
                      {managementReview.repeatIssues.length > 0 && (
                        <div>
                          <p className="font-medium mb-1">Repeat Issues</p>
                          <p className="text-muted-foreground">{managementReview.repeatIssues.join('; ')}</p>
                        </div>
                      )}
                      <div>
                        <p className="font-medium mb-1">Improvement Opportunities</p>
                        <ul className="list-decimal pl-4 text-muted-foreground">
                          {managementReview.improvementOpportunities.map((o) => <li key={o}>{o}</li>)}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                  {dashboardMetrics && dashboardCharts && (
                    <CapaReportsCharts charts={dashboardCharts} compact />
                  )}
                </>
              ) : (
                <EmptyState title="No management data" message="CAPA data required for management review summary." />
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
            <DialogHeader><DialogTitle>CAPA Report Generation Wizard</DialogTitle></DialogHeader>

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
                  <Select value={reportType} onValueChange={(v) => setReportType(v as CapaReportFormData['report_type'])} disabled={readOnly}>
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
                <div><Label>CAPA Number</Label><Input value={capaNumber} onChange={(e) => setCapaNumber(e.target.value)} placeholder="Optional filter" disabled={readOnly} /></div>
                <div><Label>Department</Label>
                  <Select value={department} onValueChange={setDepartment} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CAPA_REPORT_FILTER_OPTIONS.departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Product</Label>
                  <Select value={product} onValueChange={setProduct} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Source</Label>
                  <Select value={capaSource} onValueChange={setCapaSource} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CAPA_REPORT_FILTER_OPTIONS.sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Priority</Label>
                  <Select value={priority} onValueChange={setPriority} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CAPA_REPORT_FILTER_OPTIONS.priorities.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CAPA_REPORT_FILTER_OPTIONS.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Effectiveness</Label>
                  <Select value={effectiveness} onValueChange={setEffectiveness} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CAPA_REPORT_FILTER_OPTIONS.effectiveness.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Owner</Label>
                  <Select value={owner} onValueChange={setOwner} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2"><Checkbox checked={overdueOnly} onCheckedChange={(v) => setOverdueOnly(Boolean(v))} disabled={readOnly} /><Label>Overdue Only</Label></div>
                <div className="flex items-center gap-2"><Checkbox checked={criticalOnly} onCheckedChange={(v) => setCriticalOnly(Boolean(v))} disabled={readOnly} /><Label>Critical Only</Label></div>
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
                <CapaReportsAnalyticsKpis metrics={analytics.metrics} />
                {previewTableData.length ? (
                  <ResponsiveDataTable columns={previewTableColumns} data={previewTableData} mobileTitleKey="capa_number" mobileSubtitleKey="department" pageSize={8} />
                ) : (
                  <EmptyState title="Empty report" message="No CAPA records match filters — adjust criteria or save empty state report." />
                )}
                {step === 3 && <CapaReportsCharts charts={analytics.charts} compact />}
                <DialogFooter className="flex-wrap gap-2">
                  <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                  {canGenerate && !readOnly && canGenerateCapaReportType(role, reportType) && (
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
            <CapaAggregateReportPdf
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
    </CapaReportsAccessGuard>
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
