'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Plus, Download, Eye, Printer } from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  RISK_CATEGORIES, RISK_METHODOLOGIES, RISK_SOURCES, RISK_STATUSES,
  riskAssessmentFormSchema, calculateRiskAssessment, summarizeRiskAssessments,
  buildRiskAssessmentMatrix, buildRiskAssessmentHeatMap, buildRiskAssessmentCharts,
  riskLevelColor, isOverdue, generateRiskNumber,
  type RiskAssessmentFormData, type RiskAssessmentRecord,
} from '@/lib/cpv-risk-assessment-records';
import {
  fetchRiskAssessmentRecords, createRiskAssessment, logRiskExport,
} from '@/lib/cpv-risk-assessment-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { RiskMatrix } from './risk-matrix';
import { RiskHeatMap } from './risk-heatmap';
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
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ColumnDef } from '@/components/admin/admin-data-table';

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cls = ['Closed', 'Accepted'].includes(status) ? 'bg-green-50 text-green-700 border-green-200'
    : status === 'Rejected' ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-amber-50 text-amber-700 border-amber-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function ScoreField({ form, name, label }: {
  form: ReturnType<typeof useForm<RiskAssessmentFormData>>;
  name: 'severityScore' | 'occurrenceScore' | 'detectionScore';
  label: string;
}) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
          <SelectContent>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )} />
  );
}

export function RiskAssessmentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateRiskAssessment(role);
  const canImportExport = cpvPermissions.canImportExportRiskAssessment(role);

  const [records, setRecords] = useState<RiskAssessmentRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState(batchQuery || '');
  const [productFilter, setProductFilter] = useState(productQuery || 'all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' };

  const form = useForm<RiskAssessmentFormData>({
    resolver: zodResolver(riskAssessmentFormSchema),
    defaultValues: {
      cpvProductId: '',
      productName: '',
      productCode: '',
      batchNumber: '',
      title: '',
      methodology: 'FMEA',
      riskCategory: 'Process Risk',
      riskSource: 'Manual Assessment',
      processStage: '',
      parameterType: 'CPP',
      parameterName: '',
      riskDescription: '',
      potentialImpact: '',
      potentialCause: '',
      existingControls: '',
      severityScore: 5,
      occurrenceScore: 4,
      detectionScore: 5,
      riskOwner: profile?.full_name || '',
      mitigationAction: '',
      targetCompletionDate: '',
      effectivenessCheckRequired: true,
      linkedCapaNumber: '',
      linkedDeviationNumber: '',
      linkedOosNumber: '',
      linkedChangeControlNumber: '',
      remarks: '',
      changeReason: '',
    },
  });

  const scorePreview = calculateRiskAssessment(
    Number(form.watch('severityScore')),
    Number(form.watch('occurrenceScore')),
    Number(form.watch('detectionScore')),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods] = await Promise.all([fetchRiskAssessmentRecords(), fetchProducts()]);
      setRecords(rows.filter((r) => !r.isDeleted));
      setProducts(prods);
    } catch {
      setError('Failed to load risk assessments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (productQuery) setProductFilter(productQuery);
  }, [productQuery]);

  useEffect(() => {
    if (batchQuery) setSearch(batchQuery);
  }, [batchQuery]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter((r) => {
      if (productFilter !== 'all' && r.productName !== productFilter && r.productCode !== productFilter) return false;
      if (categoryFilter !== 'all' && r.riskCategory !== categoryFilter) return false;
      if (levelFilter !== 'all' && r.riskLevel !== levelFilter) return false;
      if (statusFilter !== 'all' && r.riskStatus !== statusFilter) return false;
      if (ownerFilter !== 'all' && r.riskOwner !== ownerFilter) return false;
      const created = r.createdAt?.slice(0, 10) || '';
      if (dateFrom && created < dateFrom) return false;
      if (dateTo && created > dateTo) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q)
        || r.riskNumber.toLowerCase().includes(q)
        || r.riskDescription.toLowerCase().includes(q)
        || r.batchNumber.toLowerCase().includes(q);
    });
  }, [records, search, productFilter, categoryFilter, levelFilter, statusFilter, ownerFilter, dateFrom, dateTo]);

  const summary = useMemo(() => summarizeRiskAssessments(records), [records]);
  const avgHealth = useMemo(() => {
    if (!records.length) return 0;
    return Math.round(records.reduce((s, r) => {
      const calc = calculateRiskAssessment(r.severityScore, r.occurrenceScore, r.detectionScore);
      return s + (Number(r.healthScore) || calc.healthScore);
    }, 0) / records.length);
  }, [records]);
  const capaSuggestedCount = useMemo(() => records.filter((r) => r.capaSuggested).length, [records]);
  const matrix = useMemo(() => buildRiskAssessmentMatrix(filtered), [filtered]);
  const heatMap = useMemo(() => buildRiskAssessmentHeatMap(filtered), [filtered]);
  const charts = useMemo(() => buildRiskAssessmentCharts(filtered), [filtered]);
  const owners = useMemo(() => Array.from(new Set(records.map((r) => r.riskOwner).filter(Boolean))).sort(), [records]);

  const onProductPick = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    form.setValue('cpvProductId', productId);
    form.setValue('productName', p.productName);
    form.setValue('productCode', p.productCode);
  };

  const saveRisk = form.handleSubmit(async (values) => {
    setSubmitting(true);
    const { error: err } = await createRiskAssessment(values, actor, records.length);
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success('Risk assessment saved');
      setDialogOpen(false);
      await load();
    }
  });

  const exportRegister = () => {
    downloadCsv('cpv-risk-register.csv',
      ['Risk Number', 'Product', 'Batch', 'Category', 'Methodology', 'Description', 'RPN', 'Residual RPN', 'Health', 'Level', 'Status', 'Owner'],
      filtered.map((r) => {
        const calc = calculateRiskAssessment(r.severityScore, r.occurrenceScore, r.detectionScore, {
          severity: r.residualSeverity,
          occurrence: r.residualOccurrence,
          detection: r.residualDetection,
        });
        return [
          r.riskNumber, r.productName, r.batchNumber, r.riskCategory,
          r.methodology || 'FMEA',
          r.riskDescription,
          r.rpnScore,
          r.residualRpn || calc.residualRpn || '',
          Number(r.healthScore) || calc.healthScore,
          r.riskLevel, r.riskStatus, r.riskOwner,
        ];
      }),
    );
    void logRiskExport(actor, 'register', filtered.length);
    toast.success('Risk register exported');
  };

  const columns: ColumnDef<RiskAssessmentRecord>[] = [
    {
      key: 'riskNumber',
      header: 'Risk No.',
      render: (r) => (
        <button
          type="button"
          className="font-mono text-left text-primary hover:underline"
          onClick={() => router.push(`/cpv/risk-assessment/${r.id}`)}
        >
          {r.riskNumber}
        </button>
      ),
    },
    { key: 'productName', header: 'Product' },
    { key: 'batchNumber', header: 'Batch' },
    { key: 'riskCategory', header: 'Category' },
    { key: 'riskDescription', header: 'Description', render: (r) => <span className="line-clamp-2 max-w-[200px]">{r.riskDescription}</span> },
    { key: 'rpnScore', header: 'RPN' },
    { key: 'riskLevel', header: 'Level', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'riskStatus', header: 'Status', render: (r) => <StatusBadge status={r.riskStatus} /> },
    { key: 'riskOwner', header: 'Owner' },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button variant="ghost" size="icon" onClick={() => router.push(`/cpv/risk-assessment/${r.id}`)}>
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
        title="CPV Risk Assessment Worksheet"
        description="Quality Risk Management and Risk Control based on ICH Q9"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'CPV', href: '/cpv/dashboard' },
          { label: 'Risk Assessment Worksheet' },
        ]}
        actions={
          <>
            {canImportExport && (
              <>
                <Button variant="outline" size="sm" className="gap-2" onClick={exportRegister}>
                  <Download className="h-4 w-4" />Export
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => { printPage(); void logRiskExport(actor, 'matrix', 1); }}>
                  <Printer className="h-4 w-4" />Export PDF
                </Button>
              </>
            )}
            {canCreate && (
              <Button size="sm" className="gap-2" onClick={() => {
                form.reset({
                  cpvProductId: '',
                  productName: '',
                  productCode: '',
                  batchNumber: batchQuery || '',
                  title: '',
                  methodology: 'FMEA',
                  riskCategory: 'Process Risk',
                  riskSource: 'Manual Assessment',
                  processStage: '',
                  parameterType: 'CPP',
                  parameterName: '',
                  riskDescription: '',
                  potentialImpact: '',
                  potentialCause: '',
                  existingControls: '',
                  severityScore: 5,
                  occurrenceScore: 4,
                  detectionScore: 5,
                  riskOwner: profile?.full_name || '',
                  mitigationAction: '',
                  targetCompletionDate: '',
                  effectivenessCheckRequired: true,
                  linkedCapaNumber: '',
                  linkedDeviationNumber: '',
                  linkedOosNumber: '',
                  linkedChangeControlNumber: '',
                  remarks: '',
                  changeReason: '',
                });
                setDialogOpen(true);
              }}>
                <Plus className="h-4 w-4" />New Risk
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
          { href: '/cpv/process-capability', label: 'Process Capability' },
          { href: productQuery ? `/cpv/trend-analysis?product=${encodeURIComponent(productQuery)}` : '/cpv/trend-analysis', label: 'Trend Analysis' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: batchQuery ? `/cpv/batch-registration?batch=${encodeURIComponent(batchQuery)}` : '/cpv/batch-registration', label: 'Batch' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/qms/change-control', label: 'Change Control' },
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
        <KpiCard label="Total Risks" value={summary.total} />
        <KpiCard label="Open" value={summary.open} tone="amber" />
        <KpiCard label="Critical" value={summary.critical} tone="red" />
        <KpiCard label="High" value={summary.high} tone="amber" />
        <KpiCard label="Overdue" value={summary.overdue} tone={summary.overdue ? 'red' : 'green'} />
        <KpiCard label="Avg Health" value={avgHealth} tone="blue" />
        <KpiCard label="CAPA Suggested" value={capaSuggestedCount} tone={capaSuggestedCount ? 'amber' : 'green'} />
        <KpiCard label="Closed" value={summary.closed} tone="green" />
        <KpiCard label="CAPA Linked" value={summary.capaLinked} tone="blue" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <CardTitle className="text-base">Risk Register</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.productName}>{p.productName}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {RISK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={levelFilter} onValueChange={setLevelFilter}>
                <SelectTrigger><SelectValue placeholder="Level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  {['Low', 'Medium', 'High', 'Critical'].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  {RISK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger><SelectValue placeholder="Owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All owners</SelectItem>
                  {owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length
            ? <ResponsiveDataTable columns={columns} data={filtered} pageSize={10} mobileTitleKey="riskNumber" mobileSubtitleKey="productName" />
            : <EmptyState title="No risk records" message="Create a risk assessment to begin." />}
        </CardContent>
      </Card>

      <Tabs defaultValue="matrix" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 lg:grid-cols-4">
          <TabsTrigger value="matrix">Risk Matrix</TabsTrigger>
          <TabsTrigger value="heatmap">Heat Map</TabsTrigger>
          <TabsTrigger value="charts">Analytics</TabsTrigger>
          <TabsTrigger value="top">Top 10 Risks</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix">
          <Card>
            <CardHeader><CardTitle className="text-base">5×5 Risk Matrix</CardTitle></CardHeader>
            <CardContent>
              {filtered.length ? <RiskMatrix matrix={matrix} /> : <EmptyState title="No data" message="No risks in scope." />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="heatmap">
          <Card>
            <CardHeader><CardTitle className="text-base">Risk Heat Map</CardTitle></CardHeader>
            <CardContent>
              {filtered.length ? <RiskHeatMap heatMap={heatMap} /> : <EmptyState title="No data" message="No risks in scope." />}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="charts">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Risk Distribution</CardTitle></CardHeader>
              <CardContent className="h-[280px]">
                {charts.levelDistribution.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={charts.levelDistribution} dataKey="count" nameKey="level" cx="50%" cy="50%" outerRadius={90} label>
                        {charts.levelDistribution.map((entry) => (
                          <Cell key={entry.level} fill={riskLevelColor(entry.level as 'Low' | 'Medium' | 'High' | 'Critical')} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="No data" message="No risks to chart." />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Monthly Risk Trend</CardTitle></CardHeader>
              <CardContent className="h-[280px]">
                {charts.monthlyTrend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={charts.monthlyTrend}>
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="No data" message="No trend data." />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Risk Category Trend</CardTitle></CardHeader>
              <CardContent className="h-[280px]">
                {charts.categoryTrend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={charts.categoryTrend} layout="vertical">
                      <XAxis type="number" />
                      <YAxis dataKey="category" type="category" width={120} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#059669" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="No data" message="No category data." />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Risk Status Trend</CardTitle></CardHeader>
              <CardContent className="h-[280px]">
                {charts.statusTrend.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={charts.statusTrend}>
                      <XAxis dataKey="status" tick={{ fontSize: 10 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="count" fill="#d97706" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="No data" message="No status data." />}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="top">
          <Card>
            <CardHeader><CardTitle className="text-base">Top 10 Risks by RPN</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {charts.topRisks.length ? charts.topRisks.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-left text-sm hover:bg-slate-50"
                  onClick={() => router.push(`/cpv/risk-assessment/${r.id}`)}
                >
                  <div>
                    <p className="font-mono font-semibold">{r.riskNumber}</p>
                    <p className="text-muted-foreground line-clamp-1">{r.riskDescription}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">RPN {r.rpnScore}</span>
                    <RiskBadge level={r.riskLevel} />
                    {isOverdue(r) && <span className="text-xs text-red-600">Overdue</span>}
                  </div>
                </button>
              )) : <EmptyState title="No risks" message="No risks recorded." />}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader><CardTitle className="text-base">RPN Scoring Guide (ICH Q9)</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p><strong className="text-emerald-700">Low:</strong> RPN 1–50</p>
          <p><strong className="text-amber-700">Medium:</strong> RPN 51–100</p>
          <p><strong className="text-orange-700">High:</strong> RPN 101–200</p>
          <p><strong className="text-red-700">Critical:</strong> RPN 201–1000</p>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Risk Assessment</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={saveRisk} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormItem>
                  <FormLabel>Product</FormLabel>
                  <Select onValueChange={onProductPick}>
                    <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
                <FormField control={form.control} name="batchNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Batch Number</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title (optional)</FormLabel>
                    <FormControl><Input {...field} placeholder="Short risk title" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="methodology" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Methodology</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {RISK_METHODOLOGIES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="riskCategory" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Risk Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {RISK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="riskSource" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Risk Source</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {RISK_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="parameterName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parameter Name</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="riskOwner" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Risk Owner</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="riskDescription" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Risk Description</FormLabel>
                    <FormControl><Textarea {...field} rows={3} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <ScoreField form={form} name="severityScore" label="Severity (1–10)" />
                <ScoreField form={form} name="occurrenceScore" label="Occurrence (1–10)" />
                <ScoreField form={form} name="detectionScore" label="Detection (1–10)" />
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-xs text-muted-foreground">Auto-calculated · {generateRiskNumber(records.length)}</p>
                  <p className="mt-1 text-2xl font-bold">RPN {scorePreview.rpnScore}</p>
                  <RiskBadge level={scorePreview.riskLevel} />
                </div>
                <FormField control={form.control} name="mitigationAction" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Mitigation Action</FormLabel>
                    <FormControl><Textarea {...field} rows={2} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="targetCompletionDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Completion Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="changeReason" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Change Reason * (ALCOA+)</FormLabel>
                    <FormControl><Textarea {...field} rows={2} placeholder="Minimum 5 characters" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save Risk'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
