'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Download, Eye, Pencil, CheckCircle, Layers, FilterX, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie } from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  summarizeYieldRecords, buildYieldChartSeries, YIELD_STAGES, YIELD_STATUSES, yieldMonitoringFormSchema,
  DEFAULT_YIELD_LIMITS,
  type YieldMonitoringFormData, type YieldMonitoringRecord,
} from '@/lib/cpv-yield-monitoring';
import {
  fetchYieldRecords, fetchYieldBatchesForProduct,
  createYieldRecord, updateYieldRecord, approveYieldRecord, reviewYieldRecord,
  bulkCreateYieldRecords, logYieldExport, yieldStageTrendData, softDeleteYieldRecord,
  buildYieldComputedFields,
  fetchYieldStageLimits,
} from '@/lib/cpv-yield-monitoring-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { YieldTrendChart } from './yield-trend-chart';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnDef } from '@/components/admin/admin-data-table';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];
type EsignAction = 'approve' | 'delete' | 'qa-override';
type YieldActorInput = { id: string; name: string; role: string };

const defaultFormFields = (): Partial<YieldMonitoringFormData> => ({
  productVersion: '', manufacturingOrder: '', workOrder: '', campaign: '', batchSize: '', batchSizeUnit: '',
  processStep: '', department: '', site: '', productionLine: '', equipmentId: '', equipmentName: '',
  operator: '', supervisor: '', shift: '', unit: 'units', recordedBy: '', reviewedBy: '', reviewDate: '',
  rejectQuantity: 0, reworkQuantity: 0, scrapQuantity: 0, wasteQuantity: 0, releasedQuantity: undefined,
  materialConsumed: undefined, materialVariance: undefined, specificationNumber: '', version: '1.0',
  calculationVersion: '1.0', effectiveDate: '', description: '', remarks: '', changeReason: '',
  autoDeviationRequired: true, alertLimitLow: undefined, alertLimitHigh: undefined,
  actionLimitLow: undefined, actionLimitHigh: undefined,
});

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function YieldPctBadge({ pct }: { pct: number }) {
  const cls = pct >= 96 ? 'bg-green-50 text-green-700 border-green-200'
    : pct >= 90 ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-700 border-red-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{pct}%</span>;
}

export function YieldMonitoringPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateYield(role) && !cpvPermissions.isYieldViewOnly(role);
  const canReview = cpvPermissions.canReviewYield(role);
  const canImportExport = cpvPermissions.canImportExportYield(role);
  const canQaOverride = cpvPermissions.canReviewYield(role);
  const isReadOnly = cpvPermissions.isReadOnly(role) || cpvPermissions.isYieldViewOnly(role);

  const [records, setRecords] = useState<YieldMonitoringRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<YieldMonitoringRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<YieldMonitoringRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<YieldMonitoringRecord | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<EsignAction>('approve');

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [productFilter, setProductFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [trendStage, setTrendStage] = useState<string>('Bulk Yield');

  const [formProductId, setFormProductId] = useState('');
  const [formBatches, setFormBatches] = useState<Awaited<ReturnType<typeof fetchYieldBatchesForProduct>>>([]);
  const [form, setForm] = useState<Partial<YieldMonitoringFormData>>({});

  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkBatchId, setBulkBatchId] = useState('');
  const [bulkReason, setBulkReason] = useState('Bulk yield entry');
  const [bulkRows, setBulkRows] = useState<Array<{
    stage: string; theoretical: string; actual: string; remarks: string;
    lowerLimit: number; upperLimit: number; targetYield: number;
  }>>([]);

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' };

  useEffect(() => {
    setSearch(productQuery || batchQuery);
    setProductFilter(productQuery || 'all');
    setBatchFilter(batchQuery || 'all');
  }, [productQuery, batchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods] = await Promise.all([fetchYieldRecords(), fetchProducts()]);
      setRecords(rows);
      setProducts(prods);
    } catch {
      setError('Failed to load yield records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return records.filter((r) => {
      if (productFilter !== 'all' && r.productName !== productFilter && r.productCode !== productFilter) return false;
      if (batchFilter !== 'all' && r.batchNumber !== batchFilter) return false;
      if (stageFilter !== 'all' && r.yieldStage !== stageFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (departmentFilter !== 'all' && r.department !== departmentFilter) return false;
      if (siteFilter !== 'all' && r.site !== siteFilter) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q) || r.productCode.toLowerCase().includes(q)
        || r.batchNumber.toLowerCase().includes(q) || r.yieldStage.toLowerCase().includes(q)
        || r.department.toLowerCase().includes(q) || r.site.toLowerCase().includes(q);
    });
  }, [records, search, productFilter, batchFilter, stageFilter, statusFilter, riskFilter, departmentFilter, siteFilter]);

  const summary = useMemo(() => summarizeYieldRecords(records), [records]);
  const charts = useMemo(() => buildYieldChartSeries(filtered), [filtered]);
  const trendData = useMemo(() => yieldStageTrendData(filtered, trendStage), [filtered, trendStage]);
  const productNames = useMemo(() => Array.from(new Set(records.map((r) => r.productName))), [records]);
  const batchNumbers = useMemo(() => Array.from(new Set(records.map((r) => r.batchNumber))), [records]);
  const departments = useMemo(() => Array.from(new Set(records.map((r) => r.department).filter(Boolean))), [records]);
  const sites = useMemo(() => Array.from(new Set(records.map((r) => r.site).filter(Boolean))), [records]);
  const clearFilters = () => {
    setSearch(''); setProductFilter('all'); setBatchFilter('all'); setStageFilter('all');
    setStatusFilter('all'); setRiskFilter('all'); setDepartmentFilter('all'); setSiteFilter('all');
  };

  const formComputed = useMemo(() => {
    const theoretical = Number(form.theoreticalQuantity) || Number(form.batchSize) || 0;
    const actual = Number(form.actualQuantity) || 0;
    const lower = form.lowerLimit;
    const upper = form.upperLimit;
    const target = form.targetYield;
    if (!theoretical || !actual || lower === undefined || upper === undefined || target === undefined) {
      return null;
    }
    return buildYieldComputedFields({
      theoreticalQuantity: theoretical,
      actualQuantity: actual,
      lowerLimit: Number(lower),
      upperLimit: Number(upper),
      targetYield: Number(target),
      alertLimitLow: form.alertLimitLow,
      alertLimitHigh: form.alertLimitHigh,
      actionLimitLow: form.actionLimitLow,
      actionLimitHigh: form.actionLimitHigh,
    });
  }, [form]);

  const onFormProductChange = async (productId: string) => {
    setFormProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setForm((f) => ({ ...f, cpvProductId: productId, productName: p.productName, productCode: p.productCode }));
    setFormBatches(await fetchYieldBatchesForProduct(p.productName));
  };

  const onBatchChange = (batchNumber: string) => {
    const batch = formBatches.find((b) => b.batchNumber === batchNumber);
    const batchSizeNum = batch?.batchSize != null ? Number(batch.batchSize) : undefined;
    setForm((f) => ({
      ...f,
      batchNumber,
      manufacturingDate: batch?.manufacturingDate || f.manufacturingDate,
      batchSize: batch?.batchSize != null ? String(batch.batchSize) : f.batchSize,
      batchSizeUnit: batch?.batchSizeUnit ? String(batch.batchSizeUnit) : f.batchSizeUnit,
      theoreticalQuantity: Number.isFinite(batchSizeNum) && (batchSizeNum as number) > 0
        ? (batchSizeNum as number)
        : f.theoreticalQuantity,
    }));
  };

  const onStageChange = async (stage: YieldMonitoringFormData['yieldStage']) => {
    const limits = (await fetchYieldStageLimits(stage)) || DEFAULT_YIELD_LIMITS[stage];
    if (!limits) {
      toast.error('Yield limits are not available for this stage.');
      return;
    }
    setForm((f) => ({
      ...f,
      yieldStage: stage,
      lowerLimit: limits.lowerLimit,
      upperLimit: limits.upperLimit,
      targetYield: limits.targetYield,
    }));
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...defaultFormFields(),
      yieldStage: YIELD_STAGES[0],
      recordedBy: profile?.full_name || '',
    });
    void onStageChange(YIELD_STAGES[0]);
    const preselected = products.find((p) => p.productCode === productQuery || p.productName === productQuery);
    if (preselected) void onFormProductChange(preselected.id);
    setFormOpen(true);
  };

  const parseFormData = (): YieldMonitoringFormData | null => {
    const theoretical = Number(form.theoreticalQuantity) || Number(form.batchSize) || 0;
    const parsed = yieldMonitoringFormSchema.safeParse({
      ...form,
      theoreticalQuantity: theoretical > 0 ? theoretical : form.theoreticalQuantity,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || 'Validation failed');
      return null;
    }
    return parsed.data;
  };

  const saveForm = async (qaOverride = false, esignConfirmed = false) => {
    const data = parseFormData();
    if (!data) return;
    const requiresQaOverride = (editing?.isLocked && canQaOverride) || data.actualQuantity > data.theoreticalQuantity;
    if (requiresQaOverride && !qaOverride) {
      if (!canQaOverride) { toast.error('QA override authority is required when actual quantity exceeds theoretical quantity.'); return; }
      setEsignAction('qa-override');
      setEsignOpen(true);
      return;
    }
    setSubmitting(true);
    if (editing) {
      const { error: err } = await (updateYieldRecord as unknown as (
        id: string, payload: YieldMonitoringFormData, actor: YieldActorInput, current: YieldMonitoringRecord, override?: boolean, options?: { esignConfirmed: boolean },
      ) => ReturnType<typeof updateYieldRecord>)(editing.id, data, actor, editing, qaOverride, { esignConfirmed });
      if (err) toast.error(err);
      else { toast.success('Record updated'); setFormOpen(false); await load(); }
    } else {
      const { error: err } = await (createYieldRecord as unknown as (
        payload: YieldMonitoringFormData, actor: YieldActorInput, override?: boolean, options?: { esignConfirmed: boolean },
      ) => ReturnType<typeof createYieldRecord>)(data, actor, qaOverride, { esignConfirmed });
      if (err) toast.error(err);
      else { toast.success('Record created'); setFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const applyQaOverride = async () => {
    await saveForm(true, true);
    setEsignOpen(false);
  };

  const applyApprove = async () => {
    if (!approveTarget) return;
    setSubmitting(true);
    const { error: err } = await (approveYieldRecord as unknown as (
      id: string, actor: YieldActorInput, reason: string, options?: { esignConfirmed: boolean },
    ) => ReturnType<typeof approveYieldRecord>)(approveTarget.id, actor, actionReason, { esignConfirmed: true });
    setSubmitting(false); setEsignOpen(false); setApproveTarget(null); setActionReason('');
    if (err) toast.error(err); else { toast.success('Record approved'); await load(); }
  };

  const applyDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    const { error: err } = await softDeleteYieldRecord(deleteTarget.id, actor, actionReason, { esignConfirmed: true });
    setSubmitting(false); setEsignOpen(false); setDeleteTarget(null); setActionReason('');
    if (err) toast.error(err); else { toast.success('Record soft-deleted'); await load(); }
  };

  const openBulk = async () => {
    if (!products[0]) return;
    setBulkProductId(products[0].id);
    setFormBatches(await fetchYieldBatchesForProduct(products[0].productName));
    const configuredRows = (await Promise.all(YIELD_STAGES.map(async (stage) => {
      const limits = (await fetchYieldStageLimits(stage)) || DEFAULT_YIELD_LIMITS[stage];
      if (!limits) return null;
      return { stage, theoretical: '', actual: '', remarks: '', ...limits };
    }))).filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (!configuredRows.length) {
      toast.error('No yield stage limits are available.');
      return;
    }
    setBulkRows(configuredRows);
    setBulkOpen(true);
  };

  const saveBulk = async () => {
    const p = products.find((x) => x.id === bulkProductId);
    const batch = formBatches.find((b) => b.id === bulkBatchId);
    if (!p || !batch) { toast.error('Select product and batch'); return; }
    if (bulkReason.trim().length < 5) { toast.error('Bulk change reason must be at least 5 characters'); return; }
    const rows: YieldMonitoringFormData[] = bulkRows.filter((r) => r.theoretical && r.actual).map((row) => {
      return {
        ...defaultFormFields(),
        cpvProductId: bulkProductId,
        productName: p.productName,
        productCode: p.productCode,
        batchNumber: batch.batchNumber,
        manufacturingDate: batch.manufacturingDate,
        batchSize: batch.batchSize != null ? String(batch.batchSize) : '',
        batchSizeUnit: batch.batchSizeUnit ? String(batch.batchSizeUnit) : '',
        yieldStage: row.stage as YieldMonitoringFormData['yieldStage'],
        theoreticalQuantity: Number(row.theoretical),
        actualQuantity: Number(row.actual),
        rejectQuantity: 0,
        reworkQuantity: 0,
        scrapQuantity: 0,
        wasteQuantity: 0,
        lowerLimit: row.lowerLimit,
        upperLimit: row.upperLimit,
        targetYield: row.targetYield,
        unit: 'units',
        recordedBy: profile?.full_name || '',
        reviewedBy: '',
        reviewDate: '',
        remarks: row.remarks,
        autoDeviationRequired: true,
        changeReason: bulkReason,
      } as YieldMonitoringFormData;
    });
    if (!rows.length) { toast.error('Enter at least one theoretical and actual quantity'); return; }
    setSubmitting(true);
    const { created, errors } = await (bulkCreateYieldRecords as unknown as (
      payload: YieldMonitoringFormData[], actor: YieldActorInput, reason?: string, override?: boolean,
    ) => ReturnType<typeof bulkCreateYieldRecords>)(rows, actor, bulkReason, canQaOverride);
    setSubmitting(false);
    if (errors.length) toast.error(errors[0]);
    toast.success(`${created} yield records saved`);
    setBulkOpen(false);
    await load();
  };

  const columns: ColumnDef<YieldMonitoringRecord>[] = [
    { key: 'batchNumber', header: 'Batch' },
    { key: 'yieldStage', header: 'Stage' },
    { key: 'yieldPercentage', header: 'Yield %', render: (r) => <YieldPctBadge pct={r.yieldPercentage} /> },
    { key: 'variancePercentage', header: 'Variance' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
  ];

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="Yield Monitoring"
        description="Monitor bulk, filling, packing and overall yield for CPV batches"
        trail={[{ label: 'Continued Process Verification', href: '/cpv/dashboard' }, { label: 'Yield Monitoring' }]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                downloadCsv(`yield-monitoring-${new Date().toISOString().split('T')[0]}.csv`,
                  ['ID', 'Product', 'Batch', 'Stage', 'Theoretical', 'Actual', 'Scrap', 'Waste', 'Released', 'Material Consumed', 'Yield %', 'Loss', 'Variance', 'Status', 'Risk', 'Department', 'Site', 'Review'],
                  filtered.map((r) => [r.yieldMonitoringId, r.productCode, r.batchNumber, r.yieldStage, r.theoreticalQuantity, r.actualQuantity, r.scrapQuantity, r.wasteQuantity, r.releasedQuantity ?? '', r.materialConsumed ?? '', r.yieldPercentage, r.lossQuantity, r.variancePercentage, r.status, r.riskLevel, r.department, r.site, r.reviewStatus].map(String)));
                await logYieldExport(actor, filtered.length);
                toast.success(`Exported ${filtered.length} yield records`);
              }}><Download className="h-4 w-4" />Export</Button>
            )}
            <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => printPage()}><Printer className="h-4 w-4" />Print</Button>
            {canCreate && !isReadOnly && (
              <>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => void openBulk()}><Layers className="h-4 w-4" />Bulk Entry</Button>
                <Button size="sm" className="gap-2" onClick={openCreate}><Plus className="h-4 w-4" />New Record</Button>
              </>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: productQuery ? `/cpv/product-master?search=${encodeURIComponent(productQuery)}` : '/cpv/product-master', label: 'Product Master' },
          { href: batchQuery ? `/cpv/batch-registration?search=${encodeURIComponent(batchQuery)}` : '/cpv/batch-registration', label: 'Batch' },
          { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
          { href: batchQuery ? `/cpv/cqa?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cqa?product=${encodeURIComponent(productQuery)}` : '/cpv/cqa', label: 'CQA' },
          { href: '/cpv/raw-material-monitoring', label: 'Raw Material' }, { href: '/cpv/packing-material-monitoring', label: 'Packing Material' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' }, { href: '/cpv/utility-monitoring', label: 'Utility' },
          { href: '/qms/deviation', label: 'Deviation' }, { href: '/qms/capa', label: 'CAPA' }, { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/admin/audit-trail', label: 'Audit Trail' }, { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/statistical-process-control', label: 'SPC' }, { href: '/cpv/trend-analysis', label: 'Trends' },
        ].map((link) => <Link key={link.href + link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">{link.label}</Link>)}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        <KpiCard label="Total Records" value={summary.total} tone="blue" />
        <KpiCard label="Compliant" value={summary.compliant} tone="green" />
        <KpiCard label="Low Yield" value={summary.lowYield} tone="red" />
        <KpiCard label="High Yield" value={summary.highYield} tone="amber" />
        <KpiCard label="OOS" value={summary.oos} tone="red" />
        <KpiCard label="OOT / Alert" value={summary.oot} tone="amber" />
        <KpiCard label="Avg Bulk" value={`${summary.avgBulkYield}%`} tone="blue" />
        <KpiCard label="Avg Filling" value={`${summary.avgFillingYield}%`} tone="blue" />
        <KpiCard label="Avg Packing" value={`${summary.avgPackingYield}%`} tone="green" />
        <KpiCard label="Avg Overall" value={`${summary.avgOverallYield}%`} tone="green" />
        <KpiCard label="Deviation" value={summary.deviationTriggered} tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Bulk Yield Trend</CardTitle></CardHeader>
          <CardContent>{charts.bulkYieldTrend.length ? <YieldTrendChart data={charts.bulkYieldTrend} /> : <EmptyState title="No bulk yield data" />}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Filling Yield Trend</CardTitle></CardHeader>
          <CardContent>{charts.fillingYieldTrend.length ? <YieldTrendChart data={charts.fillingYieldTrend} /> : <EmptyState title="No filling yield data" />}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Packing Yield Trend</CardTitle></CardHeader>
          <CardContent>{charts.packingYieldTrend.length ? <YieldTrendChart data={charts.packingYieldTrend} /> : <EmptyState title="No packing yield data" />}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Overall Yield Trend</CardTitle></CardHeader>
          <CardContent>{charts.overallYieldTrend.length ? <YieldTrendChart data={charts.overallYieldTrend} /> : <EmptyState title="No overall yield data" />}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Batch Comparison</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.batchComparison.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.batchComparison}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="batch" tick={{ fontSize: 9 }} /><YAxis domain={[0, 100]} /><Tooltip /><Bar dataKey="overall" fill={CHART_COLORS[0]} name="Yield %" /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No batch comparison data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Variance Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.varianceTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.varianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Line type="monotone" dataKey="variance" stroke={CHART_COLORS[2]} strokeWidth={2} /></LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No variance data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Risk Distribution</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.riskDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={charts.riskDistribution} dataKey="count" nameKey="level" cx="50%" cy="50%" outerRadius={70} label>
                  {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No risk data" />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Stage Trend</CardTitle>
          <Select value={trendStage} onValueChange={setTrendStage}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>{YIELD_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="h-[240px]">
          {trendData.length ? <YieldTrendChart data={trendData} /> : <EmptyState title="No trend data" />}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid gap-3 lg:grid-cols-8">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="lg:col-span-2" />
            <Select value={productFilter} onValueChange={setProductFilter}><SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Products</SelectItem>{productNames.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
            <Select value={batchFilter} onValueChange={setBatchFilter}><SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Batches</SelectItem>{batchNumbers.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
            <Select value={stageFilter} onValueChange={setStageFilter}><SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Stages</SelectItem>{YIELD_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Status</SelectItem>{YIELD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Risk</SelectItem>{['Low', 'Medium', 'High', 'Critical'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}><SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Departments</SelectItem>{departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
            <Select value={siteFilter} onValueChange={setSiteFilter}><SelectTrigger><SelectValue placeholder="Site" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Sites</SelectItem>{sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Button variant="outline" size="sm" className="gap-1" onClick={clearFilters}><FilterX className="h-3.5 w-3.5" />Clear</Button>
          </div>
          {filtered.length === 0 ? <EmptyState title="No yield records" /> : (
            <ResponsiveDataTable
              columns={columns}
              data={filtered}
              pageSize={10}
              onRowClick={(r) => router.push(`/cpv/yield-monitoring/${r.id}`)}
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => router.push(`/cpv/yield-monitoring/${row.id}`)}><Eye className="h-4 w-4" /></Button>
                  {canCreate && !isReadOnly && (!row.isLocked || canQaOverride) && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(row); setForm({ ...row, changeReason: '' }); setFormProductId(row.cpvProductId); void onFormProductChange(row.cpvProductId); setFormOpen(true);
                    }}><Pencil className="h-4 w-4" /></Button>
                  )}
                  {canReview && row.reviewStatus === 'Draft' && (
                    <Button size="icon" variant="ghost" onClick={async () => {
                      const { error: err } = await (reviewYieldRecord as unknown as (
                        id: string, actor: YieldActorInput, reason?: string,
                      ) => ReturnType<typeof reviewYieldRecord>)(row.id, actor, 'Submitted for QA review');
                      if (err) toast.error(err); else { toast.success('Submitted for review'); await load(); }
                    }}><CheckCircle className="h-4 w-4" /></Button>
                  )}
                  {canReview && (row.reviewStatus === 'Under Review' || row.reviewStatus === 'Draft') && (
                    <Button size="sm" variant="outline" onClick={() => { setApproveTarget(row); setActionReason(''); }}>Approve</Button>
                  )}
                  {canReview && row.reviewStatus !== 'Approved' && !row.isDeleted && (
                    <Button size="icon" variant="ghost" onClick={() => { setDeleteTarget(row); setActionReason(''); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  )}
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>{editing ? 'Edit Yield Record' : 'New Yield Record'}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-3">
            {editing?.isLocked && canQaOverride && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                Record locked. <Button variant="link" className="h-auto p-0" onClick={() => void saveForm(true)}>QA Override</Button>
              </div>
            )}
            {!editing && (
              <div><Label>CPV Product *</Label>
                <Select value={formProductId} onValueChange={(v) => void onFormProductChange(v)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Batch *</Label>
              <Select value={form.batchNumber || ''} onValueChange={onBatchChange}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Yield Stage *</Label>
              <Select value={form.yieldStage || YIELD_STAGES[0]} onValueChange={(v) => onStageChange(v as YieldMonitoringFormData['yieldStage'])} disabled={Boolean(editing)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{YIELD_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>QTY *</Label><Input className="mt-1" type="number" value={form.actualQuantity ?? ''} onChange={(e) => setForm((f) => ({ ...f, actualQuantity: Number(e.target.value) }))} /></div>
              <div><Label>Lower Limit % *</Label><Input className="mt-1" type="number" value={form.lowerLimit ?? ''} onChange={(e) => setForm((f) => ({ ...f, lowerLimit: Number(e.target.value) }))} /></div>
              <div><Label>Upper Limit % *</Label><Input className="mt-1" type="number" value={form.upperLimit ?? ''} onChange={(e) => setForm((f) => ({ ...f, upperLimit: Number(e.target.value) }))} /></div>
              <div>
                <Label>Observe Yield % *</Label>
                <Input className="mt-1" readOnly value={formComputed ? formComputed.yieldPercentage : ''} placeholder="Auto-calculated" />
              </div>
              <div className="sm:col-span-2"><Label>Recorded By *</Label><Input className="mt-1" value={form.recordedBy || ''} onChange={(e) => setForm((f) => ({ ...f, recordedBy: e.target.value }))} /></div>
            </div>
            <div><Label>Remarks</Label><Textarea className="mt-1" value={form.remarks || ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
            <div><Label>Change Reason *</Label><Textarea className="mt-1" value={form.changeReason || ''} onChange={(e) => setForm((f) => ({ ...f, changeReason: e.target.value }))} placeholder="Minimum 5 characters (ALCOA+)" /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={() => void saveForm()} disabled={submitting}>Save</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bulk Yield Entry</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 py-2">
            <Select value={bulkProductId} onValueChange={async (v) => {
              setBulkProductId(v);
              const p = products.find((x) => x.id === v);
              if (p) setFormBatches(await fetchYieldBatchesForProduct(p.productName));
            }}>
              <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={bulkBatchId} onValueChange={setBulkBatchId}>
              <SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Change Reason *</Label><Textarea className="mt-1" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} /></div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Stage</TableHead><TableHead>Limits</TableHead><TableHead>Theoretical Qty</TableHead>
              <TableHead>Actual</TableHead><TableHead>Remarks</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {bulkRows.map((row, i) => {
                const computed = row.theoretical && row.actual
                  ? buildYieldComputedFields({
                    theoreticalQuantity: Number(row.theoretical),
                    actualQuantity: Number(row.actual),
                    lowerLimit: row.lowerLimit,
                    upperLimit: row.upperLimit,
                    targetYield: row.targetYield,
                  })
                  : null;
                return (
                  <TableRow key={row.stage}>
                    <TableCell>{row.stage}</TableCell>
                    <TableCell className="text-xs">{row.lowerLimit}–{row.upperLimit}%</TableCell>
                    <TableCell><Input value={row.theoretical} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, theoretical: e.target.value } : r))} /></TableCell>
                    <TableCell><Input value={row.actual} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, actual: e.target.value } : r))} /></TableCell>
                    <TableCell>
                      <Input value={row.remarks} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, remarks: e.target.value } : r))} />
                      {computed && <span className="text-xs text-muted-foreground">{computed.yieldPercentage}% · {computed.status}</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={() => void saveBulk()} disabled={submitting}>Save All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(approveTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve Yield Record</DialogTitle><p className="text-sm text-muted-foreground">Change reason and electronic signature are required (Part 11 / ALCOA+).</p></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button><Button disabled={submitting} onClick={() => {
            if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
            setEsignAction('approve'); setEsignOpen(true);
          }}>Continue to E-Sign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Soft-Delete Yield Record</DialogTitle><p className="text-sm text-muted-foreground">Archive this record with a change reason and electronic signature.</p></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" disabled={submitting} onClick={() => {
            if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
            setEsignAction('delete'); setEsignOpen(true);
          }}>Continue to E-Sign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Yield Monitoring"
        recordId={esignAction === 'approve' ? approveTarget?.id || '' : esignAction === 'delete' ? deleteTarget?.id || '' : editing?.id || ''}
        documentNumber={esignAction === 'approve' ? approveTarget?.yieldMonitoringId || '' : esignAction === 'delete' ? deleteTarget?.yieldMonitoringId || '' : editing?.yieldMonitoringId || ''}
        actionType={esignAction === 'approve' ? 'Approve' : esignAction === 'delete' ? 'Soft Delete' : 'QA Override'}
        onSuccess={() => { if (esignAction === 'approve') void applyApprove(); else if (esignAction === 'delete') void applyDelete(); else void applyQaOverride(); }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
