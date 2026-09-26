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
  summarizeTrendAnalysis, buildTrendAnalysisCharts,
  DATA_SOURCES, TREND_STATUSES, DEFAULT_PQR_TRENDS,
  canCreateTrendForDataSource,
  type TrendAnalysisFormData,
  type TrendAnalysisRecord,
  type TrendSourcePoint,
} from '@/lib/cpv-trend-records';
import {
  fetchTrendAnalysisRecords,
  fetchParametersForTrend, previewTrendCalculation,
  createTrendAnalysis, regenerateTrendAnalysis,
  trendTypeForDataSource, parameterTypeForDataSource,
  logTrendExport, previewTrendSourceData,
} from '@/lib/cpv-trend-analysis-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { downloadCsv } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { ParameterTrendChart } from './parameter-trend-chart';
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

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function TrendStatusBadge({ status }: { status: string }) {
  const cls = status === 'OOS' ? 'bg-red-50 text-red-700 border-red-200'
    : status === 'OOT' || status === 'Action Required' ? 'bg-orange-50 text-orange-700 border-orange-200'
      : status === 'Alert' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

export function TrendAnalysisPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateTrendAnalysis(role);
  const canEdit = cpvPermissions.canEditTrendAnalysis(role) || canCreate;
  const canReview = cpvPermissions.canReviewTrendAnalysis(role);
  void canReview;
  const canImportExport = cpvPermissions.canImportExportTrendAnalysis(role);

  const [records, setRecords] = useState<TrendAnalysisRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [compareProducts, setCompareProducts] = useState<string[]>([]);
  const [compareParameters, setCompareParameters] = useState<string[]>([]);

  const [search, setSearch] = useState(batchQuery || '');
  const [productFilter, setProductFilter] = useState(productQuery || 'all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [form, setForm] = useState<Partial<TrendAnalysisFormData>>({});
  const [parameters, setParameters] = useState<string[]>([]);
  const [sourcePreview, setSourcePreview] = useState<TrendSourcePoint[]>([]);
  const [calcPreview, setCalcPreview] = useState<ReturnType<typeof previewTrendCalculation> | null>(null);

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods] = await Promise.all([fetchTrendAnalysisRecords(), fetchProducts()]);
      setRecords(rows.filter((r) => !r.isDeleted));
      setProducts(prods);
    } catch {
      setError('Failed to load trend analysis records.');
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
      void fetchParametersForTrend(form.dataSource, form.productName).then(setParameters);
    }
  }, [wizardStep, form.dataSource, form.productName]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter((r) => {
      if (productFilter !== 'all' && r.productName !== productFilter && r.productCode !== productFilter) return false;
      if (sourceFilter !== 'all' && r.dataSource !== sourceFilter) return false;
      if (statusFilter !== 'all' && r.trendStatus !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (workflowFilter !== 'all' && r.status !== workflowFilter) return false;
      const periodEnd = r.reviewPeriodTo || r.generatedDate || r.createdAt;
      if (dateFrom && periodEnd < dateFrom) return false;
      if (dateTo && periodEnd > dateTo) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q) || r.parameterName.toLowerCase().includes(q)
        || r.trendId.toLowerCase().includes(q)
        || r.sourcePreview.some((p) => (p.batchNumber || '').toLowerCase().includes(q));
    });
  }, [records, search, productFilter, sourceFilter, statusFilter, riskFilter, workflowFilter, dateFrom, dateTo]);

  const compareParamRecords = useMemo(() => {
    if (!compareParameters.length) return [];
    return filtered.filter((r) => compareParameters.includes(r.parameterName));
  }, [filtered, compareParameters]);

  const compareRecords = useMemo(() => {
    if (!compareProducts.length) return [];
    return filtered.filter((r) => compareProducts.includes(r.productName));
  }, [filtered, compareProducts]);

  const summary = useMemo(() => summarizeTrendAnalysis(records), [records]);
  const charts = useMemo(() => buildTrendAnalysisCharts(filtered), [filtered]);
  const driftCount = useMemo(() => records.filter((r) => r.processDriftDetected).length, [records]);
  const avgHealth = useMemo(() => {
    if (!records.length) return 0;
    return Math.round(records.reduce((s, r) => s + (r.healthScore || 0), 0) / records.length);
  }, [records]);

  const onProductChange = async (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setForm((f) => ({ ...f, cpvProductId: productId, productName: p.productName, productCode: p.productCode }));
    if (form.dataSource) {
      const params = await fetchParametersForTrend(form.dataSource, p.productName);
      setParameters(params);
    }
  };

  const onDataSourceChange = async (source: string) => {
    if (!canCreateTrendForDataSource(role, source as TrendAnalysisFormData['dataSource'])) {
      toast.error('Your role cannot generate trends for this data source.');
      return;
    }
    const ds = source as TrendAnalysisFormData['dataSource'];
    setForm((f) => ({
      ...f,
      dataSource: ds,
      trendType: trendTypeForDataSource(ds),
      parameterType: parameterTypeForDataSource(ds),
      parameterName: '',
      parameterCode: '',
    }));
    if (form.productName) {
      const params = await fetchParametersForTrend(source, form.productName);
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
    const data = await previewTrendSourceData(form as TrendAnalysisFormData, actor);
    setSourcePreview(data);
    if (data.length >= 3) {
      const calc = previewTrendCalculation(form as TrendAnalysisFormData, data);
      setCalcPreview(calc);
    } else {
      setCalcPreview(null);
    }
    setWizardStep(5);
  };

  const runCalculation = () => {
    if (sourcePreview.length < 3) {
      toast.error('At least 3 numeric data points required');
      return;
    }
    const calc = previewTrendCalculation(form as TrendAnalysisFormData, sourcePreview);
    setCalcPreview(calc);
    setWizardStep(7);
  };

  const saveTrend = async () => {
    if (!calcPreview || calcPreview.dataPointsCount < 3) {
      toast.error('At least 3 numeric data points required');
      return;
    }
    if (!form.changeReason || form.changeReason.trim().length < 5) {
      toast.error('Change reason (min 5 characters) is required');
      return;
    }
    setSubmitting(true);
    const { error: err } = await createTrendAnalysis(form as TrendAnalysisFormData, sourcePreview, actor);
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success('Trend analysis saved');
      setWizardOpen(false);
      await load();
    }
  };

  const exportList = () => {
    downloadCsv('trend-analysis.csv',
      ['ID', 'Product', 'Parameter', 'Source', 'Direction', 'Status', 'Risk', 'Health', 'Forecast', 'Cpk'],
      filtered.map((r) => [
        r.trendId, r.productName, r.parameterName, r.dataSource,
        r.trendDirection, r.trendStatus, r.riskLevel, r.healthScore, r.forecastNext, r.cpk,
      ]),
    );
    void logTrendExport(actor, 'CSV', filtered.length);
    toast.success(`Exported ${filtered.length} records`);
  };

  const columns: ColumnDef<TrendAnalysisRecord>[] = [
    { key: 'trendId', header: 'ID' },
    { key: 'productName', header: 'Product' },
    { key: 'parameterName', header: 'Parameter' },
    { key: 'dataSource', header: 'Source' },
    { key: 'trendDirection', header: 'Direction' },
    { key: 'trendStatus', header: 'Status', render: (r) => <TrendStatusBadge status={r.trendStatus} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'healthScore', header: 'Health' },
    { key: 'status', header: 'Workflow' },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/cpv/trend-analysis/${r.id}`)}>
            <Eye className="h-4 w-4" />
          </Button>
          {canEdit && r.status !== 'Approved' && (
            <Button variant="ghost" size="icon" onClick={async () => {
              const reason = window.prompt('Change reason (min 5 chars)');
              if (!reason || reason.trim().length < 5) { toast.error('Change reason required'); return; }
              const { error: err } = await regenerateTrendAnalysis(r.id, actor, r, false, { changeReason: reason });
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
    <div className="space-y-6">
      <CpvPageHeader
        title="Trend Analysis"
        description="Analyze process, quality, yield, stability and utility trends for Continued Process Verification"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Trend Analysis' },
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
                  trendType: 'CPP Trend',
                  parameterType: 'CPP',
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
                <Plus className="h-4 w-4" />Generate Trend
              </Button>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
          { href: '/cpv/cqa', label: 'CQA' },
          { href: '/cpv/yield-monitoring', label: 'Yield' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: '/cpv/utility-monitoring', label: 'Utility' },
          { href: '/cpv/hold-time-monitoring', label: 'Hold Time' },
          { href: '/cpv/stability-monitoring', label: 'Stability' },
          { href: '/cpv/process-capability', label: 'Process Capability' },
          { href: '/cpv/batch-registration', label: 'Batch' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/ai-analytics', label: 'AI Analytics' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Total Trends" value={summary.total} />
        <KpiCard label="Normal" value={summary.normal} tone="green" />
        <KpiCard label="Alert" value={summary.alert} tone="amber" />
        <KpiCard label="OOT" value={summary.oot} tone="amber" />
        <KpiCard label="OOS" value={summary.oos} tone="red" />
        <KpiCard label="Action Required" value={summary.actionRequired} tone="red" />
        <KpiCard label="Process Drift" value={driftCount} tone="amber" />
        <KpiCard label="Avg Health" value={avgHealth} tone="blue" />
        <KpiCard label="High Risk" value={summary.highRisk} tone="amber" />
        <KpiCard label="CAPA Suggested" value={summary.capaSuggested} tone="amber" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <CardTitle className="text-base">Trend Records</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.productName}>{p.productName}</SelectItem>)}
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
                <SelectTrigger><SelectValue placeholder="Trend status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {TREND_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
            : <EmptyState title="No trend records" message="Generate a trend analysis to begin." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Compare Parameters</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set(records.map((r) => r.parameterName))).slice(0, 12).map((param) => {
              const selected = compareParameters.includes(param);
              return (
                <Button
                  key={param}
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  onClick={() => setCompareParameters((prev) =>
                    selected ? prev.filter((x) => x !== param) : [...prev, param],
                  )}
                >
                  {param}
                </Button>
              );
            })}
          </div>
          {compareParamRecords.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {compareParamRecords.slice(0, 4).map((r) => (
                <ParameterTrendChart key={r.id} data={r.chartData} title={`${r.parameterName} — ${r.productName}`} height={260} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Compare Products</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {products.map((p) => {
              const selected = compareProducts.includes(p.productName);
              return (
                <Button
                  key={p.id}
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  onClick={() => setCompareProducts((prev) =>
                    selected ? prev.filter((x) => x !== p.productName) : [...prev, p.productName],
                  )}
                >
                  {p.productName}
                </Button>
              );
            })}
          </div>
          {compareRecords.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {compareRecords.slice(0, 4).map((r) => (
                <ParameterTrendChart key={r.id} data={r.chartData} title={`${r.productName} — ${r.parameterName}`} height={260} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Trend Status Distribution</CardTitle></CardHeader>
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
          <CardHeader><CardTitle className="text-base">OOT/OOS by Month</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.monthlyOotOos.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.monthlyOotOos}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="oos" name="OOS" fill="#dc2626" />
                  <Bar dataKey="oot" name="OOT" fill="#d97706" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Parameter-wise Trend Count</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.parameterTrendCount.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.parameterTrendCount} layout="vertical">
                  <XAxis type="number" />
                  <YAxis dataKey="parameter" type="category" width={100} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Product Trend Health</CardTitle></CardHeader>
          <CardContent className="h-[280px]">
            {charts.productHealth.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.productHealth}>
                  <XAxis dataKey="product" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="normal" name="Normal" fill="#059669" stackId="a" />
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
            <DialogTitle>Generate Trend — Step {wizardStep} of 10</DialogTitle>
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
                  {DATA_SOURCES.filter((s) => canCreateTrendForDataSource(role, s)).map((s) => (
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
              <p className="text-xs text-muted-foreground">PQR defaults: {DEFAULT_PQR_TRENDS.slice(0, 5).join(', ')}…</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setWizardStep(2)}>Back</Button>
                <Button onClick={() => setWizardStep(4)} disabled={!form.parameterName}>Next</Button>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
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
                <Button variant="outline" onClick={() => setWizardStep(3)}>Back</Button>
                <Button onClick={() => void loadSourcePreview()} disabled={!form.reviewPeriodFrom || !form.reviewPeriodTo}>Preview Data</Button>
              </div>
            </div>
          )}

          {wizardStep === 5 && (
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
                <Button variant="outline" onClick={() => setWizardStep(4)}>Back</Button>
                <Button onClick={() => { runCalculation(); setWizardStep(6); }} disabled={sourcePreview.length < 3}>Generate Chart</Button>
              </div>
            </div>
          )}

          {wizardStep === 6 && calcPreview && (
            <div className="space-y-4">
              <ParameterTrendChart data={calcPreview.chartData} title={form.parameterName} />
              <div className="grid gap-2 sm:grid-cols-3 text-sm">
                <div>Mean: {calcPreview.mean}</div>
                <div>Median: {calcPreview.median}</div>
                <div>SD: {calcPreview.standardDeviation}</div>
                <div>Direction: {calcPreview.trendDirection}</div>
                <div>Status: {calcPreview.trendStatus}</div>
                <div>Forecast: {calcPreview.forecastNext}</div>
                <div>Cpk: {calcPreview.cpk || '—'}</div>
                <div>Health: {calcPreview.healthScore}</div>
                <div>EWMA: {calcPreview.ewmaLast}</div>
              </div>
              <Button onClick={() => setWizardStep(7)}>Continue</Button>
            </div>
          )}

          {wizardStep === 7 && calcPreview && (
            <div className="space-y-3">
              <ParameterTrendChart data={calcPreview.chartData} title={`${form.parameterName} — calculated`} height={280} />
              <p className="text-sm text-muted-foreground">Review auto-calculated statistics before adding conclusions.</p>
              <Button onClick={() => setWizardStep(8)}>Add Conclusion</Button>
            </div>
          )}

          {wizardStep === 8 && (
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
                setWizardStep(9);
              }}>Preview Save</Button>
            </div>
          )}

          {wizardStep === 9 && calcPreview && (
            <div className="space-y-3 text-sm">
              <p><strong>Product:</strong> {form.productName}</p>
              <p><strong>Parameter:</strong> {form.parameterName}</p>
              <p><strong>Status:</strong> {calcPreview.trendStatus} · {calcPreview.trendDirection}</p>
              <p><strong>Data points:</strong> {calcPreview.dataPointsCount}</p>
              <p><strong>Health / Confidence:</strong> {calcPreview.healthScore} / {calcPreview.confidenceScore}</p>
              <p><strong>Forecast next:</strong> {calcPreview.forecastNext}</p>
              {calcPreview.processDriftDetected && <p className="text-amber-700">Process drift detected</p>}
              {calcPreview.capaSuggested && <p className="text-amber-700">CAPA suggested based on trend signals.</p>}
              <p className="text-muted-foreground">{calcPreview.aiRecommendation}</p>
            </div>
          )}

          {wizardStep === 10 && calcPreview && (
            <div className="space-y-3 text-sm">
              <p className="font-medium">Ready to save trend analysis record.</p>
              <p>After saving, QA can review and approve from the detail view. Approved records are locked unless QA override is used.</p>
              <ParameterTrendChart data={calcPreview.chartData} title={form.parameterName} height={240} />
            </div>
          )}

          <DialogFooter className="gap-2">
            {wizardStep === 9 && (
              <Button variant="outline" onClick={() => setWizardStep(8)}>Back</Button>
            )}
            {wizardStep === 9 && (
              <Button onClick={() => setWizardStep(10)}>Continue to Save</Button>
            )}
            {wizardStep === 10 && (
              <Button onClick={() => void saveTrend()} disabled={submitting}>
                {submitting ? 'Saving…' : 'Save Trend'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
