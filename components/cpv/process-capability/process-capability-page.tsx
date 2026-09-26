'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Download, Eye, Calculator, RefreshCw, FilterX, Printer, Trash2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  summarizeProcessCapability, buildProcessCapabilityCharts, forecastNextCpk,
  PARAMETER_TYPES, CAPABILITY_STATUSES, dataSourceForType, processCapabilityFormSchema,
  type ProcessCapabilityFormData, type ProcessCapabilityRecord,
} from '@/lib/cpv-process-capability';
import {
  fetchProcessCapabilityRecords, fetchCapabilitySourceData,
  fetchParametersForProduct, previewCapabilityCalculation,
  createProcessCapability, recalculateProcessCapability,
  reviewProcessCapability, approveProcessCapability, softDeleteProcessCapability,
  logProcessCapabilityExport, type SourceDataPoint,
} from '@/lib/cpv-process-capability-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { CapabilityChart, CapabilityTrendChart } from './capability-chart';
import { KpiCard, StatusBadge } from '@/components/cpv/cpv-ui';
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
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];
type EsignAction = 'approve' | 'delete' | 'qa-override';

const defaultFormFields = (): Partial<ProcessCapabilityFormData> => ({
  capabilityCode: '', studyNumber: '', productVersion: '', batchNumber: '', manufacturingOrder: '',
  process: '', processStep: '', equipmentId: '', equipmentName: '', machine: '', department: 'Quality Control',
  productionLine: '', site: '', effectiveDate: '', description: '', conclusion: '', recommendation: '',
  remarks: '', changeReason: '', parameterType: 'CPP', dataSource: 'CPP Results',
});

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

export function ProcessCapabilityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateProcessCapability(role) && !cpvPermissions.isProcessCapabilityViewOnly(role);
  const canEdit = cpvPermissions.canEditProcessCapability(role);
  const canReview = cpvPermissions.canReviewProcessCapability(role);
  const canImportExport = cpvPermissions.canImportExportProcessCapability(role);
  const isReadOnly = cpvPermissions.isProcessCapabilityViewOnly(role) || cpvPermissions.isReadOnly(role);

  const [records, setRecords] = useState<ProcessCapabilityRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<ProcessCapabilityRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProcessCapabilityRecord | null>(null);
  const [recalcTarget, setRecalcTarget] = useState<ProcessCapabilityRecord | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<EsignAction>('approve');

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [form, setForm] = useState<Partial<ProcessCapabilityFormData>>({});
  const [parameters, setParameters] = useState<string[]>([]);
  const [sourcePreview, setSourcePreview] = useState<SourceDataPoint[]>([]);
  const [calcPreview, setCalcPreview] = useState<ReturnType<typeof previewCapabilityCalculation> | null>(null);

  const actor = useMemo(
    () => ({ id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' }),
    [user?.uid, profile?.full_name, role],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods] = await Promise.all([fetchProcessCapabilityRecords(), fetchProducts()]);
      setRecords(rows);
      setProducts(prods);
    } catch {
      setError('Failed to load process capability records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter((r) => {
      if (typeFilter !== 'all' && r.parameterType !== typeFilter) return false;
      if (statusFilter !== 'all' && r.capabilityStatus !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      const periodEnd = (r.reviewPeriodTo || r.reviewDate || r.createdAt).slice(0, 10);
      if (dateFrom && periodEnd < dateFrom) return false;
      if (dateTo && periodEnd > dateTo) return false;
      if (!q) return true;
      return [
        r.productName, r.productCode, r.parameterName, r.capabilityId, r.capabilityCode,
        r.studyNumber, r.batchNumber, r.equipmentName, r.process, r.site,
      ].some((f) => String(f || '').toLowerCase().includes(q));
    });
  }, [records, search, typeFilter, statusFilter, riskFilter, dateFrom, dateTo]);

  const summary = useMemo(() => summarizeProcessCapability(records), [records]);
  const charts = useMemo(() => buildProcessCapabilityCharts(filtered), [filtered]);
  const forecast = useMemo(
    () => forecastNextCpk(charts.monthlyCpk.map((m) => m.cpk).filter((v) => v > 0)),
    [charts.monthlyCpk],
  );

  const onProductChange = async (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setForm((f) => ({
      ...f,
      cpvProductId: productId,
      productName: p.productName,
      productCode: p.productCode,
      productVersion: String(p.version || f.productVersion || ''),
    }));
    if (form.parameterType) {
      setParameters(await fetchParametersForProduct(form.parameterType, p.productName));
    }
  };

  const onTypeChange = async (type: string) => {
    const parameterType = type as ProcessCapabilityFormData['parameterType'];
    setForm((f) => ({
      ...f,
      parameterType,
      dataSource: dataSourceForType(parameterType),
      parameterName: '',
      parameterCode: '',
    }));
    if (form.productName) {
      setParameters(await fetchParametersForProduct(type, form.productName));
    }
  };

  const loadSourcePreview = async () => {
    if (!form.productName || !form.parameterName || !form.reviewPeriodFrom || !form.reviewPeriodTo || !form.dataSource) {
      toast.error('Complete product, parameter, and review period');
      return;
    }
    const data = await fetchCapabilitySourceData(
      form.dataSource, form.productName, form.parameterName, form.reviewPeriodFrom, form.reviewPeriodTo,
    );
    setSourcePreview(data);
    if (data.length < 5) toast.warning(`Only ${data.length} data points found — at least 5 required.`);
    if (data.length && form.lowerSpecificationLimit != null && form.upperSpecificationLimit != null) {
      const lsl = data[0].lsl ?? form.lowerSpecificationLimit;
      const usl = data[0].usl ?? form.upperSpecificationLimit;
      const target = data[0].target ?? form.targetValue;
      const next = { ...form, lowerSpecificationLimit: lsl, upperSpecificationLimit: usl, targetValue: target };
      setForm(next);
      setCalcPreview(previewCapabilityCalculation(next as ProcessCapabilityFormData, data));
    }
    setWizardStep(5);
  };

  const runCalculation = () => {
    if (form.lowerSpecificationLimit == null || form.upperSpecificationLimit == null) {
      toast.error('LSL and USL required');
      return;
    }
    setCalcPreview(previewCapabilityCalculation(form as ProcessCapabilityFormData, sourcePreview));
    setWizardStep(6);
  };

  const saveCalculation = async () => {
    const parsed = processCapabilityFormSchema.safeParse({ ...defaultFormFields(), ...form });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || 'Validation failed');
      return;
    }
    if (!calcPreview || calcPreview.sampleCount < 5) {
      toast.error('At least 5 numeric values required');
      return;
    }
    setSubmitting(true);
    const { error: err } = await createProcessCapability(parsed.data, sourcePreview, actor);
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success('Capability calculation saved');
      setWizardOpen(false);
      await load();
    }
  };

  const onEsignConfirm = async () => {
    setEsignOpen(false);
    setSubmitting(true);
    if (esignAction === 'approve' && approveTarget) {
      const { error: err } = await approveProcessCapability(approveTarget.id, actor, actionReason, { esignConfirmed: true });
      if (err) toast.error(err); else { toast.success('Approved'); setApproveTarget(null); await load(); }
    } else if (esignAction === 'delete' && deleteTarget) {
      const { error: err } = await softDeleteProcessCapability(deleteTarget.id, actor, actionReason, { esignConfirmed: true });
      if (err) toast.error(err); else { toast.success('Archived'); setDeleteTarget(null); await load(); }
    } else if (esignAction === 'qa-override' && recalcTarget) {
      const { error: err } = await recalculateProcessCapability(recalcTarget.id, actor, recalcTarget, true, {
        esignConfirmed: true, changeReason: actionReason,
      });
      if (err) toast.error(err); else { toast.success('Recalculated with QA override'); setRecalcTarget(null); await load(); }
    }
    setSubmitting(false);
  };

  const columns: ColumnDef<ProcessCapabilityRecord>[] = [
    { key: 'capabilityCode', header: 'Code', render: (r) => r.capabilityCode || r.capabilityId },
    { key: 'productName', header: 'Product' },
    { key: 'parameterName', header: 'Parameter' },
    { key: 'parameterType', header: 'Type' },
    { key: 'cpk', header: 'Cpk' },
    { key: 'ppk', header: 'Ppk' },
    { key: 'sigmaLevel', header: 'Sigma' },
    { key: 'healthScore', header: 'Health', render: (r) => r.healthScore || '—' },
    { key: 'capabilityStatus', header: 'Capability', render: (r) => <StatusBadge status={r.capabilityStatus} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'status', header: 'Workflow' },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/cpv/process-capability/${r.id}`)} aria-label="View">
            <Eye className="h-4 w-4" />
          </Button>
          {!isReadOnly && (canCreate || canEdit) && (!r.isLocked || canReview) && r.status !== 'Approved' && (
            <Button variant="ghost" size="icon" onClick={async () => {
              const reason = window.prompt('Change reason (min 5 chars) for recalculation');
              if (!reason || reason.trim().length < 5) { toast.error('Change reason required'); return; }
              const { error: err } = await recalculateProcessCapability(r.id, actor, r, false, { changeReason: reason });
              if (err) toast.error(err); else { toast.success('Recalculated'); await load(); }
            }} aria-label="Recalculate"><RefreshCw className="h-4 w-4" /></Button>
          )}
          {canReview && r.isLocked && r.status === 'Approved' && (
            <Button variant="ghost" size="icon" title="QA Override" onClick={() => {
              setRecalcTarget(r); setActionReason(''); setEsignAction('qa-override');
              setApproveTarget(null); setDeleteTarget(null);
            }}><RefreshCw className="h-4 w-4 text-amber-600" /></Button>
          )}
          {canReview && r.status === 'Calculated' && (
            <Button variant="ghost" size="icon" onClick={async () => {
              const { error: err } = await reviewProcessCapability(r.id, actor);
              if (err) toast.error(err); else { toast.success('Submitted for review'); await load(); }
            }} aria-label="Review"><CheckCircle className="h-4 w-4" /></Button>
          )}
          {canReview && r.status === 'Under Review' && (
            <Button variant="ghost" size="sm" onClick={() => {
              setApproveTarget(r); setActionReason(''); setEsignAction('approve'); setRecalcTarget(null);
            }}>Approve</Button>
          )}
          {canReview && r.status !== 'Approved' && (
            <Button variant="ghost" size="icon" onClick={() => {
              setDeleteTarget(r); setActionReason(''); setEsignAction('delete');
            }} aria-label="Archive">
              <Trash2 className="h-4 w-4 text-red-600" />
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
        title="Process Capability"
        description="Enterprise Cp/Cpk/Pp/Ppk with SPC, AI health scoring, and Part 11 controls"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Process Capability' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                downloadCsv(`process-capability-${new Date().toISOString().slice(0, 10)}.csv`,
                  ['ID', 'Code', 'Product', 'Parameter', 'Type', 'Cp', 'Cpk', 'Pp', 'Ppk', 'Sigma', 'Health', 'Status', 'Risk', 'Review'],
                  filtered.map((r) => [
                    r.capabilityId, r.capabilityCode, r.productName, r.parameterName, r.parameterType,
                    r.cp, r.cpk, r.pp, r.ppk, r.sigmaLevel, r.healthScore, r.capabilityStatus, r.riskLevel, r.status,
                  ]));
                await logProcessCapabilityExport(actor, filtered.length);
                toast.success(`Exported ${filtered.length} records`);
              }}><Download className="h-4 w-4" />Export</Button>
            )}
            <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => printPage()}><Printer className="h-4 w-4" />Print</Button>
            {canCreate && (
              <Button size="sm" className="gap-2" onClick={() => {
                setForm({ ...defaultFormFields(), reviewPeriodFrom: '', reviewPeriodTo: '' });
                setSourcePreview([]); setCalcPreview(null); setWizardStep(1); setWizardOpen(true);
              }}><Plus className="h-4 w-4" />New Calculation</Button>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
          { href: batchQuery ? `/cpv/cqa?batch=${encodeURIComponent(batchQuery)}` : '/cpv/cqa', label: 'CQA' },
          { href: '/cpv/yield-monitoring', label: 'Yield' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: '/cpv/utility-monitoring', label: 'Utility' },
          { href: '/cpv/hold-time-monitoring', label: 'Hold Time' },
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Total Reviews" value={summary.total} />
        <KpiCard label="Excellent" value={summary.excellent} tone="green" />
        <KpiCard label="Acceptable" value={summary.acceptable} tone="green" />
        <KpiCard label="Needs Improvement" value={summary.needsImprovement} tone="amber" />
        <KpiCard label="Not Capable" value={summary.notCapable} tone="red" />
        <KpiCard label="Low Cpk (&lt;1.33)" value={summary.lowCpk} tone="amber" />
        <KpiCard label="Avg Cpk" value={summary.averageCpk} />
        <KpiCard label="Avg Ppk" value={summary.averagePpk} />
        <KpiCard label="Avg Sigma" value={summary.averageSigma} />
        <KpiCard label="AI Health Score" value={summary.averageHealthScore} tone="blue" />
        <KpiCard label="Cpk Forecast" value={forecast.next} tone={forecast.slope < 0 ? 'amber' : 'green'} />
        <KpiCard label="CAPA Recommended" value={summary.capaRecommended} tone="amber" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <CardTitle className="text-base">Capability Records</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input placeholder="Search code, product, parameter…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {PARAMETER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Capability" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {CAPABILITY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risk</SelectItem>
                  {['Low', 'Medium', 'High', 'Critical'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => {
                setSearch(''); setTypeFilter('all'); setStatusFilter('all'); setRiskFilter('all'); setDateFrom(''); setDateTo('');
              }}><FilterX className="h-4 w-4" />Clear</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length
            ? <ResponsiveDataTable columns={columns} data={filtered} pageSize={10} mobileTitleKey="parameterName" mobileSubtitleKey="productName" />
            : <EmptyState title="No capability records" message="Run a capability calculation to begin." />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cpk by Parameter</CardTitle></CardHeader>
          <CardContent>
            <CapabilityChart data={charts.cpkByParameter.map((d) => ({ label: d.name, cp: d.cp, cpk: d.cpk, ppk: d.ppk }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Monthly Average Cpk</CardTitle></CardHeader>
          <CardContent><CapabilityTrendChart data={charts.monthlyCpk} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Cp vs Cpk</CardTitle></CardHeader>
          <CardContent>
            <CapabilityChart data={charts.cpVsCpk.map((d) => ({ label: d.parameter, cp: d.cp, cpk: d.cpk }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Capability Status</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.statusDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.statusDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="status" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} /><Tooltip />
                  <Bar dataKey="count" fill="#2563eb" />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No status data" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Sigma Trend</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.sigmaTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.sigmaTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis /><Tooltip />
                  <Line type="monotone" dataKey="sigma" stroke="#7c3aed" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No sigma data" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">AI Health Score Trend</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.healthTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.healthTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis domain={[0, 100]} /><Tooltip />
                  <Line type="monotone" dataKey="score" stroke="#059669" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No health data" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Risk Distribution</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.riskDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={charts.riskDistribution} dataKey="count" nameKey="level" cx="50%" cy="50%" outerRadius={90} label>
                    {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No risk data" />}
          </CardContent>
        </Card>
      </div>

      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Capability Calculation — Step {wizardStep} of 7</DialogTitle></DialogHeader>
          {wizardStep === 1 && (
            <div className="space-y-4">
              <Label>Product *</Label>
              <Select value={form.cpvProductId || ''} onValueChange={onProductChange}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <Label>Parameter Type *</Label>
              <Select value={form.parameterType || 'CPP'} onValueChange={onTypeChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PARAMETER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {wizardStep === 3 && (
            <div className="space-y-4">
              <Label>Parameter *</Label>
              <Select value={form.parameterName || ''} onValueChange={(name) => setForm((f) => ({
                ...f, parameterName: name, parameterCode: name.replace(/\s+/g, '_').toUpperCase(),
              }))}>
                <SelectTrigger><SelectValue placeholder="Select parameter" /></SelectTrigger>
                <SelectContent>{parameters.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {wizardStep === 4 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Review Period From *</Label><Input type="date" value={form.reviewPeriodFrom || ''} onChange={(e) => setForm((f) => ({ ...f, reviewPeriodFrom: e.target.value }))} /></div>
              <div><Label>Review Period To *</Label><Input type="date" value={form.reviewPeriodTo || ''} onChange={(e) => setForm((f) => ({ ...f, reviewPeriodTo: e.target.value }))} /></div>
              <div><Label>LSL *</Label><Input type="number" value={form.lowerSpecificationLimit ?? ''} onChange={(e) => setForm((f) => ({ ...f, lowerSpecificationLimit: Number(e.target.value) }))} /></div>
              <div><Label>USL *</Label><Input type="number" value={form.upperSpecificationLimit ?? ''} onChange={(e) => setForm((f) => ({ ...f, upperSpecificationLimit: Number(e.target.value) }))} /></div>
              <div><Label>Target</Label><Input type="number" value={form.targetValue ?? ''} onChange={(e) => setForm((f) => ({ ...f, targetValue: e.target.value === '' ? undefined : Number(e.target.value) }))} /></div>
              <div><Label>Study Number</Label><Input value={form.studyNumber || ''} onChange={(e) => setForm((f) => ({ ...f, studyNumber: e.target.value }))} /></div>
              <div><Label>Site</Label><Input value={form.site || ''} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} /></div>
              <div><Label>Equipment</Label><Input value={form.equipmentName || ''} onChange={(e) => setForm((f) => ({ ...f, equipmentName: e.target.value }))} /></div>
            </div>
          )}
          {wizardStep === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{sourcePreview.length} source data points loaded</p>
              <div className="overflow-x-auto max-h-48">
                <Table>
                  <TableHeader><TableRow><TableHead>Batch</TableHead><TableHead>Value</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {sourcePreview.slice(0, 20).map((row, i) => (
                      <TableRow key={i}><TableCell>{row.batchNumber}</TableCell><TableCell>{row.value}</TableCell><TableCell>{row.date?.split('T')[0]}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {wizardStep >= 6 && calcPreview && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard label="Cpk" value={calcPreview.cpk} tone={calcPreview.cpk >= 1.33 ? 'green' : 'amber'} />
                <KpiCard label="Cp" value={calcPreview.cp} />
                <KpiCard label="Ppk" value={calcPreview.ppk} />
                <KpiCard label="Pp" value={calcPreview.pp} />
                <KpiCard label="Sigma" value={calcPreview.sigmaLevel} />
                <KpiCard label="Health" value={calcPreview.healthScore} />
                <KpiCard label="Mean" value={calcPreview.mean} />
                <KpiCard label="Std Dev" value={calcPreview.standardDeviation} />
                <KpiCard label="Samples" value={calcPreview.sampleCount} />
              </div>
              <div className="flex gap-2"><StatusBadge status={calcPreview.capabilityStatus} /><RiskBadge level={calcPreview.riskLevel} /></div>
              <p className="text-sm text-muted-foreground">{calcPreview.aiRecommendation}</p>
              <Textarea placeholder="Conclusion" value={form.conclusion || ''} onChange={(e) => setForm((f) => ({ ...f, conclusion: e.target.value }))} />
              <Textarea placeholder="Recommendation" value={form.recommendation || ''} onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))} />
              <div>
                <Label>Change Reason *</Label>
                <Textarea className="mt-1" value={form.changeReason || ''} onChange={(e) => setForm((f) => ({ ...f, changeReason: e.target.value }))} placeholder="Minimum 5 characters (ALCOA+)" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {wizardStep > 1 && <Button variant="outline" onClick={() => setWizardStep((s) => s - 1)}>Back</Button>}
            {wizardStep < 4 && <Button onClick={() => setWizardStep((s) => s + 1)}>Next</Button>}
            {wizardStep === 4 && <Button onClick={() => void loadSourcePreview()}><Calculator className="h-4 w-4 mr-1" />Load Data</Button>}
            {wizardStep === 5 && <Button onClick={runCalculation}>Calculate</Button>}
            {wizardStep >= 6 && <Button disabled={submitting} onClick={() => void saveCalculation()}>{submitting ? 'Saving…' : 'Save Calculation'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={(Boolean(approveTarget) || Boolean(recalcTarget)) && !esignOpen && esignAction !== 'delete'} onOpenChange={(open) => {
        if (!open) { setApproveTarget(null); setRecalcTarget(null); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{esignAction === 'qa-override' ? 'QA Override Recalculate' : 'Approve Capability'}</DialogTitle>
            <p className="text-sm text-muted-foreground">Change reason and electronic signature required (Part 11 / ALCOA+).</p>
          </DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApproveTarget(null); setRecalcTarget(null); }}>Cancel</Button>
            <Button disabled={submitting} onClick={() => {
              if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Archive Capability Record</DialogTitle></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignAction('delete'); setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Process Capability"
        recordId={esignAction === 'approve' ? approveTarget?.id || '' : esignAction === 'delete' ? deleteTarget?.id || '' : recalcTarget?.id || ''}
        documentNumber={esignAction === 'approve' ? approveTarget?.capabilityId || '' : esignAction === 'delete' ? deleteTarget?.capabilityId || '' : recalcTarget?.capabilityId || ''}
        actionType={esignAction === 'approve' ? 'Approve' : esignAction === 'delete' ? 'Soft Delete' : 'QA Override'}
        onSuccess={() => { void onEsignConfirm(); }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
