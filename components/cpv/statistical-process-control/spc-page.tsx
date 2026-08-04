'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Download, Eye, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, Cell, PieChart, Pie, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  summarizeSpcRecords, buildSpcCharts,
  CHART_TYPES, DATA_SOURCES, SPC_STATUSES,
  canCreateSpcForDataSource,
  type SpcFormData,
  type SpcRecord,
  type SpcSourcePoint,
} from '@/lib/cpv-spc-records';
import {
  fetchSpcRecords,
  fetchParametersForSpc, previewSpcCalculation,
  createSpcRecord, regenerateSpcRecord,
  parameterTypeForDataSource, logSpcExport, previewSpcSourceData,
} from '@/lib/cpv-spc-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { downloadCsv } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { ControlChart, MovingRangeChart } from './control-chart';
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnDef } from '@/components/admin/admin-data-table';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];

function SpcStatusBadge({ status }: { status: string }) {
  const cls = status === 'Out Of Control' ? 'bg-red-50 text-red-700 border-red-200'
    : status === 'Warning' ? 'bg-amber-50 text-amber-700 border-amber-200'
      : status === 'In Control' ? 'bg-green-50 text-green-700 border-green-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

export function SpcPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateSpc(role);
  const canEdit = cpvPermissions.canEditSpc(role) || canCreate;
  const canReview = cpvPermissions.canReviewSpc(role);
  void canReview;
  const canImportExport = cpvPermissions.canImportExportSpc(role);

  const [records, setRecords] = useState<SpcRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState(batchQuery || '');
  const [productFilter, setProductFilter] = useState(productQuery || 'all');
  const [chartFilter, setChartFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [form, setForm] = useState<Partial<SpcFormData>>({});
  const [parameters, setParameters] = useState<string[]>([]);
  const [sourcePreview, setSourcePreview] = useState<SpcSourcePoint[]>([]);
  const [calcPreview, setCalcPreview] = useState<ReturnType<typeof previewSpcCalculation> | null>(null);

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods] = await Promise.all([fetchSpcRecords(), fetchProducts()]);
      setRecords(rows.filter((r) => !r.isDeleted));
      setProducts(prods);
    } catch {
      setError('Failed to load SPC records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (productQuery) setProductFilter(productQuery);
  }, [productQuery]);

  useEffect(() => {
    if (wizardStep === 3 && form.dataSource && form.productName) {
      void fetchParametersForSpc(form.dataSource, form.productName).then(setParameters);
    }
  }, [wizardStep, form.dataSource, form.productName]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter((r) => {
      if (productFilter !== 'all' && r.productName !== productFilter && r.productCode !== productFilter) return false;
      if (chartFilter !== 'all' && r.chartType !== chartFilter) return false;
      if (sourceFilter !== 'all' && r.dataSource !== sourceFilter) return false;
      if (statusFilter !== 'all' && r.spcStatus !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (workflowFilter !== 'all' && r.status !== workflowFilter) return false;
      const periodEnd = r.reviewPeriodTo || r.generatedDate || r.createdAt;
      if (dateFrom && periodEnd < dateFrom) return false;
      if (dateTo && periodEnd > dateTo) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q) || r.parameterName.toLowerCase().includes(q)
        || r.spcRecordId.toLowerCase().includes(q)
        || r.sourcePreview.some((p) => (p.batchNumber || '').toLowerCase().includes(q));
    });
  }, [records, search, productFilter, chartFilter, sourceFilter, statusFilter, riskFilter, workflowFilter, dateFrom, dateTo]);

  const summary = useMemo(() => summarizeSpcRecords(records), [records]);
  const charts = useMemo(() => buildSpcCharts(filtered), [filtered]);
  const driftCount = useMemo(() => records.filter((r) => r.processDriftDetected).length, [records]);
  const avgHealth = useMemo(() => {
    if (!records.length) return 0;
    return Math.round(records.reduce((s, r) => s + (r.healthScore || 0), 0) / records.length);
  }, [records]);
  const westernElectricTotal = useMemo(
    () => records.reduce((s, r) => s + (r.westernElectricCount || 0), 0),
    [records],
  );

  const onProductChange = async (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setForm((f) => ({ ...f, cpvProductId: productId, productName: p.productName, productCode: p.productCode }));
    if (form.dataSource) {
      const params = await fetchParametersForSpc(form.dataSource, p.productName);
      setParameters(params);
    }
  };

  const onDataSourceChange = async (source: string) => {
    if (!canCreateSpcForDataSource(role, source as SpcFormData['dataSource'])) {
      toast.error('Your role cannot generate SPC for this data source.');
      return;
    }
    const ds = source as SpcFormData['dataSource'];
    setForm((f) => ({
      ...f,
      dataSource: ds,
      parameterType: parameterTypeForDataSource(ds),
      parameterName: '',
      parameterCode: '',
    }));
    if (form.productName) {
      const params = await fetchParametersForSpc(source, form.productName);
      setParameters(params);
    }
  };

  const loadSourcePreview = async () => {
    if (!form.productName || !form.parameterName || !form.reviewPeriodFrom || !form.reviewPeriodTo || !form.dataSource) {
      toast.error('Complete product, parameter, and review period');
      return;
    }
    if (new Date(form.reviewPeriodTo) <= new Date(form.reviewPeriodFrom)) {
      toast.error('Review period end must be after start');
      return;
    }
    const data = await previewSpcSourceData(form as SpcFormData, actor);
    setSourcePreview(data);
    if (data.length >= 5) {
      setCalcPreview(previewSpcCalculation(form as SpcFormData, data));
    } else {
      setCalcPreview(null);
    }
    setWizardStep(6);
  };

  const saveSpc = async () => {
    if (!calcPreview || calcPreview.dataPointsCount < 5) {
      toast.error('At least 5 numeric data points required');
      return;
    }
    if (!form.changeReason || form.changeReason.trim().length < 5) {
      toast.error('Change reason (min 5 characters) is required');
      return;
    }
    setSubmitting(true);
    const { error: err } = await createSpcRecord(form as SpcFormData, sourcePreview, actor);
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success('SPC record saved');
      setWizardOpen(false);
      await load();
    }
  };

  const exportList = () => {
    downloadCsv('spc-records.csv',
      ['ID', 'Product', 'Parameter', 'Chart', 'Status', 'Violations', 'OOC', 'Risk', 'Health', 'Cpk'],
      filtered.map((r) => [
        r.spcRecordId, r.productName, r.parameterName, r.chartType,
        r.spcStatus, r.ruleViolationsCount, r.outOfControlPoints, r.riskLevel,
        r.healthScore ?? '', r.cpk ?? '',
      ]),
    );
    void logSpcExport(actor, 'report', filtered.length);
    toast.success(`Exported ${filtered.length} records`);
  };

  const columns: ColumnDef<SpcRecord>[] = [
    { key: 'spcRecordId', header: 'ID' },
    { key: 'productName', header: 'Product' },
    { key: 'parameterName', header: 'Parameter' },
    { key: 'chartType', header: 'Chart' },
    { key: 'spcStatus', header: 'SPC Status', render: (r) => <SpcStatusBadge status={r.spcStatus} /> },
    { key: 'ruleViolationsCount', header: 'Violations' },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'status', header: 'Workflow' },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/cpv/statistical-process-control/${r.id}`)}>
            <Eye className="h-4 w-4" />
          </Button>
          {canEdit && r.status !== 'Approved' && (
            <Button variant="ghost" size="icon" onClick={async () => {
              const reason = window.prompt('Change reason (min 5 chars)');
              if (!reason || reason.trim().length < 5) { toast.error('Change reason required'); return; }
              const { error: err } = await regenerateSpcRecord(r.id, actor, r, false, { changeReason: reason });
              if (err) toast.error(err);
              else { toast.success('Regenerated'); await load(); }
            }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title="Statistical Process Control"
        description="Generate control charts and detect special cause variation for CPV data"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Statistical Process Control' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2" onClick={exportList}>
                <Download className="h-4 w-4" />Export
              </Button>
            )}
            {canCreate && (
              <Button size="sm" className="gap-2" onClick={() => {
                setForm({
                  dataSource: 'CPP Results',
                  parameterType: 'CPP',
                  chartType: 'Individuals Chart',
                  subgroupSize: 4,
                  reviewPeriodFrom: '',
                  reviewPeriodTo: '',
                  conclusion: '',
                  recommendation: '',
                  remarks: '',
                  changeReason: '',
                });
                setSourcePreview([]);
                setCalcPreview(null);
                setWizardStep(1);
                setWizardOpen(true);
              }}>
                <Plus className="h-4 w-4" />Generate Chart
              </Button>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
          { href: productQuery ? `/cpv/cqa?product=${encodeURIComponent(productQuery)}` : '/cpv/cqa', label: 'CQA' },
          { href: '/cpv/yield-monitoring', label: 'Yield' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: '/cpv/utility-monitoring', label: 'Utility' },
          { href: '/cpv/hold-time-monitoring', label: 'Hold Time' },
          { href: '/cpv/process-capability', label: 'Process Capability' },
          { href: '/cpv/trend-analysis', label: 'Trend Analysis' },
          { href: '/cpv/batch-registration', label: 'Batch' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/ai-analytics', label: 'AI Analytics' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Total SPC Records" value={summary.total} />
        <KpiCard label="In Control" value={summary.inControl} tone="green" />
        <KpiCard label="Out Of Control" value={summary.outOfControl} tone="red" />
        <KpiCard label="Warning" value={summary.warning} tone="amber" />
        <KpiCard label="Insufficient Data" value={summary.insufficient} />
        <KpiCard label="Rule Violations" value={summary.ruleViolations} />
        <KpiCard label="Process Drift" value={driftCount} tone="amber" />
        <KpiCard label="Avg Health" value={avgHealth} tone="blue" />
        <KpiCard label="Western Electric" value={westernElectricTotal} tone="amber" />
        <KpiCard label="High Risk" value={summary.highRisk} tone="amber" />
        <KpiCard label="Critical Risk" value={summary.criticalRisk} tone="red" />
        <KpiCard label="CAPA Suggested" value={summary.capaSuggested} tone="amber" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <CardTitle className="text-base">SPC Records</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.productName}>{p.productName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={chartFilter} onValueChange={setChartFilter}>
                <SelectTrigger><SelectValue placeholder="Chart type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All charts</SelectItem>
                  {CHART_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {DATA_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="SPC status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {SPC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risk</SelectItem>
                  {['Low', 'Medium', 'High', 'Critical'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={workflowFilter} onValueChange={setWorkflowFilter}>
                <SelectTrigger><SelectValue placeholder="Workflow" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workflow</SelectItem>
                  {['Draft', 'Generated', 'Under Review', 'Approved', 'Rejected', 'Archived'].map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length
            ? <ResponsiveDataTable columns={columns} data={filtered} pageSize={10} mobileTitleKey="parameterName" mobileSubtitleKey="productName" />
            : <EmptyState title="No SPC records" message="Generate a control chart to begin." />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">SPC Status Distribution</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.statusDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={charts.statusDistribution} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={90} label>
                    {charts.statusDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Rule Violation Trend</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.violationTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.violationTrend}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="violations" fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Risk Level Distribution</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.riskDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={charts.riskDistribution} dataKey="count" nameKey="level" cx="50%" cy="50%" outerRadius={90} label>
                    {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Parameter SPC Health</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.parameterHealth.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.parameterHealth}>
                  <XAxis dataKey="parameter" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="ok" name="In Control" fill="#059669" stackId="a" />
                  <Bar dataKey="issues" name="Issues" fill="#dc2626" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Product SPC Health</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.productHealth.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.productHealth}>
                  <XAxis dataKey="product" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="ok" name="In Control" fill="#059669" stackId="a" />
                  <Bar dataKey="issues" name="Issues" fill="#dc2626" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate SPC — Step {wizardStep} of 10</DialogTitle>
          </DialogHeader>

          {wizardStep === 1 && (
            <div className="space-y-3">
              <Label>Product</Label>
              <Select value={form.cpvProductId || ''} onValueChange={(v) => void onProductChange(v)}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={() => setWizardStep(2)} disabled={!form.cpvProductId}>Next</Button>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              <Label>Data Source</Label>
              <Select value={form.dataSource || ''} onValueChange={(v) => void onDataSourceChange(v)}>
                <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>
                  {DATA_SOURCES.filter((s) => canCreateSpcForDataSource(role, s)).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setWizardStep(1)}>Back</Button>
                <Button onClick={() => setWizardStep(3)} disabled={!form.dataSource}>Next</Button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3">
              <Label>Parameter</Label>
              <Select
                value={form.parameterName || ''}
                onValueChange={(v) => setForm((f) => ({
                  ...f,
                  parameterName: v,
                  parameterCode: v.replace(/\s+/g, '-').toUpperCase().slice(0, 30),
                }))}
              >
                <SelectTrigger><SelectValue placeholder="Select parameter" /></SelectTrigger>
                <SelectContent>
                  {parameters.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setWizardStep(2)}>Back</Button>
                <Button onClick={() => setWizardStep(4)} disabled={!form.parameterName}>Next</Button>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-3">
              <Label>Chart Type</Label>
              <Select value={form.chartType || ''} onValueChange={(v) => setForm((f) => ({ ...f, chartType: v as SpcFormData['chartType'] }))}>
                <SelectTrigger><SelectValue placeholder="Chart type" /></SelectTrigger>
                <SelectContent>
                  {CHART_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setWizardStep(3)}>Back</Button>
                <Button onClick={() => setWizardStep(5)} disabled={!form.chartType}>Next</Button>
              </div>
            </div>
          )}

          {wizardStep === 5 && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Review Period From</Label>
                  <Input type="date" value={form.reviewPeriodFrom || ''} onChange={(e) => setForm((f) => ({ ...f, reviewPeriodFrom: e.target.value }))} />
                </div>
                <div>
                  <Label>Review Period To</Label>
                  <Input type="date" value={form.reviewPeriodTo || ''} onChange={(e) => setForm((f) => ({ ...f, reviewPeriodTo: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setWizardStep(4)}>Back</Button>
                <Button onClick={() => void loadSourcePreview()} disabled={!form.reviewPeriodFrom || !form.reviewPeriodTo}>Preview Data</Button>
              </div>
            </div>
          )}

          {wizardStep === 6 && (
            <div className="space-y-3">
              <p className="text-sm">{sourcePreview.length} data points found</p>
              {sourcePreview.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sourcePreview.slice(0, 20).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.batchNumber}</TableCell>
                        <TableCell>{p.value}</TableCell>
                        <TableCell>{p.date}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState title="No numeric data" message="Adjust filters or review period." />
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setWizardStep(5)}>Back</Button>
                <Button onClick={() => {
                  if (sourcePreview.length >= 5) {
                    setCalcPreview(previewSpcCalculation(form as SpcFormData, sourcePreview));
                    setWizardStep(7);
                  } else {
                    toast.error('At least 5 numeric data points required');
                  }
                }} disabled={sourcePreview.length < 5}>Calculate Limits</Button>
              </div>
            </div>
          )}

          {wizardStep === 7 && calcPreview && (
            <div className="space-y-4">
              <ControlChart
                data={calcPreview.chartData}
                title="Individuals Chart"
                lsl={calcPreview.lowerSpecificationLimit || undefined}
                usl={calcPreview.upperSpecificationLimit || undefined}
              />
              <MovingRangeChart data={calcPreview.movingRangeData} title="Moving Range Chart" />
              <div className="grid gap-2 sm:grid-cols-3 text-sm">
                <div>CL: {calcPreview.centerLine}</div>
                <div>UCL: {calcPreview.upperControlLimit}</div>
                <div>LCL: {calcPreview.lowerControlLimit}</div>
                <div>MR Bar: {calcPreview.movingRangeAverage}</div>
                <div>Status: {calcPreview.spcStatus}</div>
                <div>Violations: {calcPreview.ruleViolationsCount}</div>
              </div>
              <Button onClick={() => setWizardStep(8)}>Detect Violations</Button>
            </div>
          )}

          {wizardStep === 8 && calcPreview && (
            <div className="space-y-3">
              <p className="text-sm">{calcPreview.ruleViolationsCount} rule violation(s) · {calcPreview.outOfControlPoints} OOC point(s)</p>
              {calcPreview.violations.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Rule</TableHead>
                      <TableHead>Severity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calcPreview.violations.slice(0, 10).map((v) => (
                      <TableRow key={v.violationId}>
                        <TableCell>{v.batchNumber}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{v.ruleDescription}</TableCell>
                        <TableCell>{v.severity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-green-700">No rule violations detected.</p>
              )}
              <Button onClick={() => setWizardStep(9)}>Add Conclusion</Button>
            </div>
          )}

          {wizardStep === 9 && (
            <div className="space-y-3">
              <Label>Conclusion</Label>
              <Textarea value={form.conclusion || ''} onChange={(e) => setForm((f) => ({ ...f, conclusion: e.target.value }))} />
              <Label>Recommendation</Label>
              <Textarea value={form.recommendation || ''} onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))} />
              <Label>Remarks</Label>
              <Textarea value={form.remarks || ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
              <Label>Change Reason * (ALCOA+)</Label>
              <Textarea
                value={form.changeReason || ''}
                onChange={(e) => setForm((f) => ({ ...f, changeReason: e.target.value }))}
                placeholder="Minimum 5 characters"
              />
              <Button onClick={() => {
                if (!form.changeReason || form.changeReason.trim().length < 5) {
                  toast.error('Change reason must be at least 5 characters');
                  return;
                }
                setWizardStep(10);
              }}>Preview Save</Button>
            </div>
          )}

          {wizardStep === 10 && calcPreview && (
            <div className="space-y-3 text-sm">
              <p><strong>Product:</strong> {form.productName}</p>
              <p><strong>Parameter:</strong> {form.parameterName}</p>
              <p><strong>Chart:</strong> {form.chartType}</p>
              <p><strong>Status:</strong> {calcPreview.spcStatus}</p>
              <p><strong>Data points:</strong> {calcPreview.dataPointsCount}</p>
              <p><strong>Health / Confidence:</strong> {calcPreview.healthScore} / {calcPreview.confidenceScore}</p>
              {calcPreview.processDriftDetected && <p className="text-amber-700">Process drift detected</p>}
              {calcPreview.capaSuggested && <p className="text-amber-700">CAPA suggested based on SPC signals.</p>}
              <p className="text-muted-foreground">{calcPreview.aiRecommendation}</p>
            </div>
          )}

          <DialogFooter className="gap-2">
            {wizardStep === 10 && (
              <>
                <Button variant="outline" onClick={() => setWizardStep(9)}>Back</Button>
                <Button onClick={() => void saveSpc()} disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save SPC Record'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
