'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Archive, ChevronRight, Download, Eye, FileSpreadsheet, FileText, Plus, Printer, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  CPV_REPORT_TYPES, canGenerateReportType, generateReportNumber, reportStatusLabel,
  reportTypeRequiresProduct, summarizeReportsAnalytics, type CpvReportFormData,
  type CpvReportMetrics, type CpvReportRecord,
} from '@/lib/cpv-reports-records';
import {
  archiveCpvReport, exportCpvReport, fetchCpvReportRecords,
  generateCpvReport, previewCpvReport,
} from '@/lib/cpv-reports-service';
import { fetchCpvProducts } from '@/lib/cpv-product-master-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { AnalyticsChart } from './analytics-chart';
import { HealthScoreBadge } from './health-score-badge';
import { ReportPreview } from './report-preview';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ColumnDef } from '@/components/admin/admin-data-table';

const STEPS = [
  'Report Type', 'Product', 'Batch', 'Date Range', 'Filters', 'Preview', 'Analytics', 'Export',
];

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'Exported' || status === 'Generated' ? 'bg-green-50 text-green-700 border-green-200'
    : status === 'Failed' ? 'bg-red-50 text-red-700 border-red-200'
      : status === 'Archived' ? 'bg-slate-50 text-slate-600 border-slate-200'
        : 'bg-amber-50 text-amber-700 border-amber-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

export function ReportsAnalyticsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canGenerate = cpvPermissions.canGenerateReports(role);
  const canExport = cpvPermissions.canExportReports(role);
  const canArchive = cpvPermissions.canArchiveReports(role);

  const [records, setRecords] = useState<CpvReportRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reportType, setReportType] = useState<CpvReportFormData['reportType']>('CPV Dashboard Summary Report');
  const [productId, setProductId] = useState('all');
  const [batchNumber, setBatchNumber] = useState('');
  const [periodFrom, setPeriodFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [periodTo, setPeriodTo] = useState(`${new Date().getFullYear()}-12-31`);
  const [changeReason, setChangeReason] = useState('');
  const [site, setSite] = useState('');
  const [department, setDepartment] = useState('');
  const [metrics, setMetrics] = useState<CpvReportMetrics | null>(null);
  const [aiSummary, setAiSummary] = useState('');
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [charts, setCharts] = useState<Record<string, unknown> | null>(null);
  const [activeReport, setActiveReport] = useState<CpvReportRecord | null>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };
  const selectedProduct = productId === 'all' ? undefined : products.find((p) => p.id === productId);
  const analytics = useMemo(() => summarizeReportsAnalytics(records, metrics || undefined), [records, metrics]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods] = await Promise.all([fetchCpvReportRecords(), fetchCpvProducts()]);
      setRecords(rows);
      setProducts(prods.filter((p) => p.status === 'Active' || !p.status));
      if (productQuery) {
        const match = prods.find((p) => p.productName === productQuery || p.productCode === productQuery);
        if (match) setProductId(match.id);
      }
    } catch {
      setError('Failed to load reports.');
    } finally {
      setLoading(false);
    }
  }, [productQuery]);

  useEffect(() => { void load(); }, [load]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (filterStatus !== 'all' && r.reportStatus !== filterStatus) return false;
      if (filterType !== 'all' && r.reportType !== filterType) return false;
      if (productQuery && r.productName !== productQuery && r.productCode !== productQuery) return false;
      if (!q) return true;
      return [r.reportNumber, r.reportType, r.productName, r.generatedBy, r.site, r.department]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [records, filterStatus, filterType, search, productQuery]);
  const buildFilters = () => ({
    reportType,
    productName: selectedProduct?.productName || 'All Products',
    productCode: selectedProduct?.productCode || '',
    batchNumber,
    reviewPeriodFrom: periodFrom,
    reviewPeriodTo: periodTo,
  });

  const runPreview = async () => {
    if (new Date(periodTo) < new Date(periodFrom)) return toast.error('End date must be after start date');
    if (reportTypeRequiresProduct(reportType) && !selectedProduct) return toast.error('Product is required for this report type');
    setPreviewing(true);
    setStep(5);
    try {
      const data = await previewCpvReport(buildFilters(), actor);
      if (!data) return toast.error('Preview failed');
      setMetrics(data.metrics);
      setPreviewRows(data.previewRows);
      setCharts(data.charts as Record<string, unknown>);
      setAiSummary(data.aiInsights?.aiExecutiveSummary || '');
      toast.success('Preview generated');
    } catch {
      toast.error('Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const saveReport = async () => {
    if (!canGenerate) return toast.error('No permission to generate reports');
    if (!canGenerateReportType(role, reportType)) return toast.error('No permission for this report type');
    if (changeReason.trim().length < 5) return toast.error('Change reason must be at least 5 characters');
    setGenerating(true);
    try {
      const { result, error: err } = await generateCpvReport({
        reportType,
        productName: selectedProduct?.productName || 'All Products',
        productCode: selectedProduct?.productCode || '',
        batchNumber,
        site,
        department,
        reviewPeriodFrom: periodFrom,
        reviewPeriodTo: periodTo,
        remarks: '',
        version: '1.0',
        changeReason: changeReason.trim(),
      }, actor, records.length);
      if (err || !result) return toast.error(err || 'Generation failed');
      setActiveReport(result);
      setMetrics(result.metrics);
      setPreviewRows(result.previewRows);
      setCharts(result.charts);
      setAiSummary(result.aiInsights?.aiExecutiveSummary || '');
      setStep(7);
      toast.success(`Report ${result.reportNumber} saved`);
      await load();
    } catch {
      toast.error('Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = async (type: 'PDF' | 'Excel' | 'CSV' | 'Print') => {
    if (!canExport) return toast.error('No export permission');
    const report = activeReport || filteredRecords[0];
    if (!report && !previewRows.length) return toast.error('Generate or preview a report first');

    if (type === 'Print') {
      printPage();
      return;
    }

    const csvContent = [
      ['Module', 'Product', 'Batch', 'Status', 'Date'],
      ...previewRows.map((r) => [
        String(r._module || ''), String(r.productName || ''), String(r.batchNo || ''),
        String(r.status || ''), String(r._date || '').slice(0, 10),
      ]),
    ].map((row) => row.join(',')).join('\n');

    if (type === 'CSV' || type === 'Excel') {
      downloadCsv(
        `cpv-report.${type === 'Excel' ? 'csv' : 'csv'}`,
        ['Module', 'Product', 'Batch', 'Status', 'Date'],
        previewRows.map((r) => [
          String(r._module || ''), String(r.productName || ''), String(r.batchNo || ''),
          String(r.status || ''), String(r._date || '').slice(0, 10),
        ]),
      );
    }

    if (report) {
      const html = `<html><body><h1>${report.reportNumber}</h1><pre>${csvContent}</pre></body></html>`;
      const { error: exportError } = await exportCpvReport(report, type, html, actor);
      if (exportError) {
        toast.error(exportError);
        await load();
        return;
      }
    }
    toast.success(`${type} export recorded`);
    await load();
  };

  const columns: ColumnDef<CpvReportRecord>[] = [
    { key: 'reportNumber', header: 'Report No.' },
    { key: 'reportType', header: 'Type', render: (r) => <span className="line-clamp-1 max-w-[160px]">{r.reportType}</span> },
    { key: 'productName', header: 'Product' },
    { key: 'generatedDate', header: 'Generated', render: (r) => String(r.generatedDate || '').slice(0, 10) },
    { key: 'reportStatus', header: 'Status', render: (r) => <StatusBadge status={reportStatusLabel(String(r.reportStatus))} /> },
    { key: 'metrics', header: 'Health', render: (r) => <HealthScoreBadge score={r.metrics?.healthScore || 0} label={r.metrics?.healthLabel} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button variant="ghost" size="icon" onClick={() => router.push(`/cpv/reports-analytics/${r.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title="Reports & Analytics"
        description="Generate CPV reports, executive KPIs, and AI analytics summaries"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Reports & Analytics' },
        ]}
        actions={(
          <>
            {canExport && (
              <>
                <Button variant="outline" size="sm" onClick={() => void handleExport('CSV')}><Download className="h-4 w-4 mr-1" />CSV</Button>
                <Button variant="outline" size="sm" onClick={() => void handleExport('PDF')}><FileText className="h-4 w-4 mr-1" />PDF</Button>
                <Button variant="outline" size="sm" onClick={() => void handleExport('Print')}><Printer className="h-4 w-4 mr-1" />Print</Button>
              </>
            )}
            {canGenerate && (
              <Button size="sm" onClick={() => {
                setWizardOpen(true); setStep(0); setMetrics(null); setPreviewRows([]);
                setChangeReason(''); setAiSummary(''); setSite(''); setDepartment('');
              }}>
                <Plus className="h-4 w-4 mr-1" />Generate Report
              </Button>
            )}
          </>
        )}
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: '/cpv/dashboard', label: 'Executive' },
          { href: productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
          { href: productQuery ? `/cpv/cqa?product=${encodeURIComponent(productQuery)}` : '/cpv/cqa', label: 'CQA' },
          { href: '/cpv/yield-monitoring', label: 'Yield' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: '/cpv/utility-monitoring', label: 'Utility' },
          { href: '/cpv/hold-time-monitoring', label: 'Hold Time' },
          { href: '/cpv/stability-monitoring', label: 'Stability' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/process-capability', label: 'Capability' },
          { href: '/cpv/trend-analysis', label: 'Trend' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/cpv/annual-review', label: 'Annual Review' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/qms/change-control', label: 'Change Control' },
          { href: '/qms/equipment/calibration-records', label: 'Calibration' },
          { href: '/qms/equipment/preventive-maintenance', label: 'Maintenance' },
          { href: '/qms/oos', label: 'OOS' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
          { href: '/cpv/ai-analytics', label: 'AI Analytics' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="Total Reports" value={analytics.totalReports} tone="blue" />
        <KpiCard label="This Month" value={analytics.reportsThisMonth} />
        <KpiCard label="Failed" value={analytics.failedReports} tone="red" />
        <KpiCard label="PDF Exports" value={analytics.pdfExports} />
        <KpiCard label="Excel Exports" value={analytics.excelExports} />
        <KpiCard label="High Risk Products" value={analytics.highRiskProducts} tone="amber" />
        <KpiCard label="OOS Count" value={analytics.oosCount} tone="red" />
        <KpiCard label="Avg Cpk" value={analytics.averageCpk.toFixed(2)} />
        <KpiCard label="CPV Compliance" value={`${analytics.cpvCompliancePct.toFixed(0)}%`} tone="green" />
        <KpiCard label="Escalations" value={filteredRecords.filter((r) => r.metrics?.escalationRequired).length} tone="amber" />
      </div>

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">Report History</TabsTrigger>
          <TabsTrigger value="analytics">Analytics Charts</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input className="w-48" placeholder="Search reports…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Report type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {CPV_REPORT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {['Draft', 'Generated', 'Exported', 'Archived', 'Failed'].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Saved Reports</CardTitle></CardHeader>
            <CardContent>
              {filteredRecords.length ? (
                <ResponsiveDataTable columns={columns} data={filteredRecords} searchKeys={['reportNumber', 'productName', 'reportType']} />
              ) : (
                <EmptyState title="No reports yet" message="Generate a CPV report using the wizard." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          {charts ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardContent className="pt-6"><AnalyticsChart title="CPP vs CQA Compliance" data={(charts.cppVsCqa as Array<{ name: string; value: number }>) || []} /></CardContent></Card>
              <Card><CardContent className="pt-6"><AnalyticsChart title="Risk Distribution" data={(charts.riskDistribution as Array<{ name: string; value: number }>) || []} type="pie" /></CardContent></Card>
              <Card><CardContent className="pt-6"><AnalyticsChart title="OOT / OOS Trend" data={(charts.ootOosTrend as Array<{ name: string; value: number }>) || []} /></CardContent></Card>
              <Card><CardContent className="pt-6"><AnalyticsChart title="Product Compliance" data={(charts.productCompliance as Array<{ name: string; compliance: number }>) || []} /></CardContent></Card>
            </div>
          ) : (
            <EmptyState title="No analytics yet" message="Preview or generate a report to view analytics charts." />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Generate CPV Report</DialogTitle></DialogHeader>
          <div className="flex flex-wrap gap-1 text-xs">
            {STEPS.map((s, i) => (
              <span key={s} className={`flex items-center gap-1 rounded px-2 py-1 ${i === step ? 'bg-blue-100 text-blue-800 font-semibold' : 'text-muted-foreground'}`}>
                {i + 1}. {s}{i < STEPS.length - 1 && <ChevronRight className="h-3 w-3" />}
              </span>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-3">
              <Label>Step 1 — Report Type *</Label>
              <Select value={reportType} onValueChange={(v) => setReportType(v as CpvReportFormData['reportType'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CPV_REPORT_TYPES.filter((t) => canGenerateReportType(role, t)).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => setStep(1)}>Next</Button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <Label>Step 2 — Product {reportTypeRequiresProduct(reportType) ? '*' : '(optional)'}</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {!reportTypeRequiresProduct(reportType) && <SelectItem value="all">All Products</SelectItem>}
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
                <Button onClick={() => setStep(2)} disabled={reportTypeRequiresProduct(reportType) && productId === 'all'}>Next</Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Label>Step 3 — Batch (optional)</Label>
              <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="Batch number" />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={() => setStep(3)}>Next</Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Step 4 — From *</Label><Input type="date" className="mt-1" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} /></div>
              <div><Label>To *</Label><Input type="date" className="mt-1" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} /></div>
              <div><Label>Site</Label><Input className="mt-1" value={site} onChange={(e) => setSite(e.target.value)} placeholder="Manufacturing site" /></div>
              <div><Label>Department</Label><Input className="mt-1" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="QA / Production" /></div>
              <p className="sm:col-span-2 text-sm text-muted-foreground">
                Report number preview: {generateReportNumber(new Date(periodTo).getFullYear(), records.length)}
              </p>
              <div className="flex gap-2 sm:col-span-2">
                <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                <Button onClick={() => setStep(4)}>Next</Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <Label>Step 5 — Filters & Change Reason *</Label>
              <div className="rounded-md border bg-slate-50 p-3 text-sm space-y-1 dark:bg-slate-900">
                <p><strong>Type:</strong> {reportType}</p>
                <p><strong>Product:</strong> {selectedProduct?.productName || 'All Products'}</p>
                <p><strong>Batch:</strong> {batchNumber || 'All batches'}</p>
                <p><strong>Period:</strong> {periodFrom} to {periodTo}</p>
                <p><strong>Site / Dept:</strong> {site || '—'} / {department || '—'}</p>
              </div>
              <div>
                <Label>Change Reason (ALCOA+) *</Label>
                <Textarea className="mt-1" rows={2} value={changeReason} onChange={(e) => setChangeReason(e.target.value)} placeholder="Why is this report being generated?" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
                <Button onClick={() => void runPreview()} disabled={previewing || changeReason.trim().length < 5}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${previewing ? 'animate-spin' : ''}`} />Preview Data
                </Button>
              </div>
            </div>
          )}

          {step >= 5 && metrics && (
            <div className="space-y-4">
              <ReportPreview metrics={metrics} rows={previewRows} />
              {aiSummary && (
                <Card><CardContent className="pt-4 text-sm space-y-1">
                  <p className="font-medium">AI Executive Summary</p>
                  <p>{aiSummary}</p>
                  {metrics.escalationRequired && <p className="text-amber-700">Escalation recommended based on health/risk signals.</p>}
                </CardContent></Card>
              )}
              {step >= 5 && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {charts && (
                    <>
                      <AnalyticsChart title="CPP vs CQA" data={(charts.cppVsCqa as Array<{ name: string; value: number }>) || []} />
                      <AnalyticsChart title="Risk Distribution" data={(charts.riskDistribution as Array<{ name: string; value: number }>) || []} type="pie" />
                    </>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!activeReport && canGenerate && (
                  <Button onClick={() => void saveReport()} disabled={generating || changeReason.trim().length < 5}>
                    {generating ? 'Saving…' : 'Save Report'}
                  </Button>
                )}
                {canExport && (
                  <>
                    <Button variant="outline" onClick={() => void handleExport('PDF')}><FileText className="h-4 w-4 mr-1" />Export PDF</Button>
                    <Button variant="outline" onClick={() => void handleExport('Excel')}><FileSpreadsheet className="h-4 w-4 mr-1" />Export Excel</Button>
                  </>
                )}
                {activeReport && canArchive && activeReport.reportStatus !== 'Archived' && (
                  <Button variant="outline" onClick={async () => {
                    const { error: archErr } = await archiveCpvReport(activeReport.id, actor, activeReport, {
                      changeReason: changeReason.trim() || 'Archived after generation',
                      esignConfirmed: true,
                    });
                    if (archErr) return toast.error(archErr);
                    toast.success('Report archived');
                    setWizardOpen(false);
                    await load();
                  }}><Archive className="h-4 w-4 mr-1" />Archive</Button>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setWizardOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
