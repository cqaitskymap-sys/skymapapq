'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Download, Eye, Pencil, Layers, FilterX, Printer, Trash2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  summarizeHoldTimeRecords, buildHoldTimeChartSeries, computeHoldTimeStats,
  HOLD_STAGES, HOLD_TIME_STATUSES, BULK_HOLD_STAGES, HOLD_TIME_UNITS,
  HOLD_MATERIAL_CATEGORIES, holdTimeMonitoringFormSchema, formatCountdown,
  type HoldTimeMonitoringFormData, type HoldTimeMonitoringRecord,
} from '@/lib/cpv-hold-time-monitoring';
import {
  fetchHoldTimeRecords, fetchHoldTimeBatchesForProduct, fetchHoldTimeMaster,
  createHoldTimeRecord, updateHoldTimeRecord, approveHoldTimeRecord, reviewHoldTimeRecord,
  bulkCreateHoldTimeRecords, logHoldTimeExport, buildHoldTimeComputedFields,
  softDeleteHoldTimeRecord, refreshLiveHoldMetrics,
} from '@/lib/cpv-hold-time-monitoring-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { ParameterTrendChart } from '@/components/cpv/cpp-monitoring/parameter-trend-chart';
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
type HoldActorInput = { id: string; name: string; role: string };

const defaultFormFields = (): Partial<HoldTimeMonitoringFormData> => ({
  holdTimeCode: '', studyNumber: '', productVersion: '', material: '', materialCategory: 'N/A',
  equipmentId: '', equipmentName: '', manufacturingOrder: '', operation: '', department: 'Production',
  productionLine: '', site: '', storageLocation: '', storageCondition: '', endDateTime: '',
  effectiveDate: '', reviewDate: '', description: '', reasonForHold: '', extensionApproved: false,
  extensionReason: '', approvedBy: '', remarks: '', autoDeviationRequired: true,
  timerStatus: 'Not Started', changeReason: '', holdTimeUnit: 'Hours',
});

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

export function HoldTimeMonitoringPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateHoldTime(role) && !cpvPermissions.isHoldTimeViewOnly(role);
  const canEdit = cpvPermissions.canEditHoldTime(role);
  const canReview = cpvPermissions.canReviewHoldTime(role);
  const canImportExport = cpvPermissions.canImportExportHoldTime(role);
  const isReadOnly = cpvPermissions.isHoldTimeViewOnly(role) || cpvPermissions.isReadOnly(role);

  const [records, setRecords] = useState<HoldTimeMonitoringRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<HoldTimeMonitoringRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<HoldTimeMonitoringRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HoldTimeMonitoringRecord | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<EsignAction>('approve');
  const [tick, setTick] = useState(0);

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [stageFilter, setStageFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [trendStage, setTrendStage] = useState<string>(HOLD_STAGES[0]);

  const [formProductId, setFormProductId] = useState('');
  const [formBatches, setFormBatches] = useState<Awaited<ReturnType<typeof fetchHoldTimeBatchesForProduct>>>([]);
  const [form, setForm] = useState<Partial<HoldTimeMonitoringFormData>>({});
  const [computedPreview, setComputedPreview] = useState<ReturnType<typeof buildHoldTimeComputedFields> | null>(null);

  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkBatchId, setBulkBatchId] = useState('');
  const [bulkReason, setBulkReason] = useState('Bulk hold time entry');
  const [bulkRows, setBulkRows] = useState<Array<{
    stage: string; start: string; end: string; allowed: number; unit: string;
  }>>([]);

  const actor = useMemo(
    () => ({ id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' }),
    [user?.uid, profile?.full_name, role],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods] = await Promise.all([fetchHoldTimeRecords(), fetchProducts()]);
      setRecords(rows);
      setProducts(prods);
    } catch {
      setError('Failed to load hold time records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live countdown for in-progress holds (every 30s)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const liveRecords = useMemo(
    () => records.map((r) => refreshLiveHoldMetrics(r)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick forces recompute
    [records, tick],
  );

  const departments = useMemo(
    () => Array.from(new Set(liveRecords.map((r) => r.department).filter(Boolean))),
    [liveRecords],
  );
  const sites = useMemo(
    () => Array.from(new Set(liveRecords.map((r) => r.site).filter(Boolean))),
    [liveRecords],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return liveRecords.filter((r) => {
      if (stageFilter !== 'all' && r.holdStage !== stageFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (categoryFilter !== 'all' && r.materialCategory !== categoryFilter) return false;
      if (departmentFilter !== 'all' && r.department !== departmentFilter) return false;
      if (siteFilter !== 'all' && r.site !== siteFilter) return false;
      const recordDate = (r.startDateTime || r.createdAt).slice(0, 10);
      if (dateFrom && recordDate < dateFrom) return false;
      if (dateTo && recordDate > dateTo) return false;
      if (!q) return true;
      return [
        r.productName, r.productCode, r.batchNumber, r.holdStage, r.holdTimeId, r.holdTimeCode,
        r.studyNumber, r.material, r.equipmentName, r.department, r.productionLine, r.storageLocation,
      ].some((f) => String(f || '').toLowerCase().includes(q));
    });
  }, [liveRecords, search, stageFilter, statusFilter, riskFilter, categoryFilter, departmentFilter, siteFilter, dateFrom, dateTo]);

  const summary = useMemo(() => summarizeHoldTimeRecords(liveRecords), [liveRecords]);
  const charts = useMemo(() => buildHoldTimeChartSeries(filtered), [filtered]);
  const spcStats = useMemo(
    () => computeHoldTimeStats(filtered.map((r) => r.actualHoldTime), 0, Math.max(...filtered.map((r) => r.allowedHoldTime), 1)),
    [filtered],
  );
  const trendData = useMemo(() => filtered
    .filter((r) => r.holdStage === trendStage)
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
    .map((r) => ({
      label: r.batchNumber,
      observed: r.actualHoldTime,
      target: r.allowedHoldTime,
      lsl: 0,
      usl: r.allowedHoldTime,
    })), [filtered, trendStage]);

  const updateComputedPreview = (partial: Partial<HoldTimeMonitoringFormData>) => {
    if (!partial.startDateTime || !partial.allowedHoldTime || !partial.holdTimeUnit) {
      setComputedPreview(null);
      return;
    }
    setComputedPreview(buildHoldTimeComputedFields({
      startDateTime: partial.startDateTime,
      endDateTime: partial.endDateTime || '',
      allowedHoldTime: partial.allowedHoldTime,
      holdTimeUnit: partial.holdTimeUnit,
      temperature: partial.temperature,
      humidity: partial.humidity,
      temperatureLimitLow: partial.temperatureLimitLow,
      temperatureLimitHigh: partial.temperatureLimitHigh,
      humidityLimitLow: partial.humidityLimitLow,
      humidityLimitHigh: partial.humidityLimitHigh,
    }));
  };

  const onFormProductChange = async (productId: string) => {
    setFormProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setForm((f) => ({
      ...f,
      cpvProductId: productId,
      productName: p.productName,
      productCode: p.productCode,
      productVersion: String(p.version || f.productVersion || ''),
    }));
    setFormBatches(await fetchHoldTimeBatchesForProduct(p.productName, productId));
  };

  const onFormBatchChange = (batchNumber: string) => {
    const batch = formBatches.find((b) => b.batchNumber === batchNumber);
    setForm((f) => ({
      ...f,
      batchNumber,
      manufacturingDate: batch?.manufacturingDate || f.manufacturingDate || '',
      manufacturingOrder: batch?.manufacturingOrderNumber || f.manufacturingOrder || '',
    }));
  };

  const onHoldStageChange = async (holdStage: string) => {
    const master = await fetchHoldTimeMaster(holdStage);
    if (!master) {
      toast.error('Hold-time master limits are not configured for this stage.');
      return;
    }
    setForm((f) => {
      const next = {
        ...f,
        holdStage,
        processStage: holdStage,
        allowedHoldTime: master.allowed,
        holdTimeUnit: master.unit as HoldTimeMonitoringFormData['holdTimeUnit'],
      };
      updateComputedPreview(next);
      return next;
    });
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...defaultFormFields(), holdStage: HOLD_STAGES[0], processStage: HOLD_STAGES[0], autoDeviationRequired: true });
    setFormProductId('');
    setComputedPreview(null);
    setFormOpen(true);
    void onHoldStageChange(HOLD_STAGES[0]);
  };

  const saveForm = async (qaOverride = false, esignConfirmed = false) => {
    const parsed = holdTimeMonitoringFormSchema.safeParse({ ...defaultFormFields(), ...form });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || 'Validation failed');
      return;
    }
    const data = parsed.data;
    if (editing?.isLocked && editing.reviewStatus === 'Approved' && !qaOverride) {
      if (!canReview) { toast.error('Approved record is locked. QA override required.'); return; }
      setEsignAction('qa-override');
      setEsignOpen(true);
      return;
    }
    setSubmitting(true);
    if (editing) {
      const { error: err } = await (updateHoldTimeRecord as (
        id: string, payload: HoldTimeMonitoringFormData, a: HoldActorInput, current: HoldTimeMonitoringRecord, override?: boolean, options?: { esignConfirmed: boolean },
      ) => ReturnType<typeof updateHoldTimeRecord>)(editing.id, data, actor, editing, qaOverride, { esignConfirmed });
      if (err) toast.error(err);
      else { toast.success('Hold time record updated'); setFormOpen(false); await load(); }
    } else {
      const { error: err } = await createHoldTimeRecord(data, actor, qaOverride, { esignConfirmed });
      if (err) toast.error(err);
      else { toast.success('Hold time record created'); setFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const loadBulkRowsForProduct = async (productId: string) => {
    setBulkProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setFormBatches(await fetchHoldTimeBatchesForProduct(p.productName, productId));
    const rows = await Promise.all(BULK_HOLD_STAGES.map(async (stage) => {
      const master = await fetchHoldTimeMaster(stage);
      if (!master) return null;
      return { stage, start: '', end: '', allowed: master.allowed, unit: master.unit };
    }));
    const configuredRows = rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (!configuredRows.length) {
      toast.error('No hold-time stage master limits are configured.');
      return;
    }
    setBulkRows(configuredRows);
  };

  const saveBulk = async () => {
    const p = products.find((x) => x.id === bulkProductId);
    const batch = formBatches.find((b) => b.id === bulkBatchId);
    if (!p || !batch) { toast.error('Select product and batch'); return; }
    if (bulkReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
    const rows: HoldTimeMonitoringFormData[] = bulkRows.filter((r) => r.start).map((row) => ({
      ...defaultFormFields(),
      cpvProductId: bulkProductId,
      productName: p.productName,
      productCode: p.productCode,
      productVersion: String(p.version || ''),
      batchNumber: batch.batchNumber,
      manufacturingDate: batch.manufacturingDate,
      processStage: row.stage,
      holdStage: row.stage,
      startDateTime: row.start,
      endDateTime: row.end,
      allowedHoldTime: row.allowed,
      holdTimeUnit: row.unit as HoldTimeMonitoringFormData['holdTimeUnit'],
      changeReason: bulkReason,
      autoDeviationRequired: true,
      materialCategory: 'N/A',
      timerStatus: 'Not Started',
      extensionApproved: false,
    } as HoldTimeMonitoringFormData));
    if (!rows.length) { toast.error('Enter start time for at least one stage'); return; }
    setSubmitting(true);
    const { created, errors } = await bulkCreateHoldTimeRecords(rows, actor, bulkReason);
    setSubmitting(false);
    if (errors.length) toast.error(errors[0]);
    toast.success(`${created} hold time records saved`);
    setBulkOpen(false);
    await load();
  };

  const onEsignConfirm = async () => {
    setEsignOpen(false);
    setSubmitting(true);
    if (esignAction === 'approve' && approveTarget) {
      const { error: err } = await approveHoldTimeRecord(approveTarget.id, actor, actionReason, { esignConfirmed: true });
      if (err) toast.error(err); else { toast.success('Approved'); setApproveTarget(null); await load(); }
    } else if (esignAction === 'delete' && deleteTarget) {
      const { error: err } = await softDeleteHoldTimeRecord(deleteTarget.id, actor, actionReason, { esignConfirmed: true });
      if (err) toast.error(err); else { toast.success('Archived'); setDeleteTarget(null); await load(); }
    } else if (esignAction === 'qa-override') {
      await saveForm(true, true);
    }
    setSubmitting(false);
  };

  const clearFilters = () => {
    setSearch(''); setStageFilter('all'); setStatusFilter('all'); setRiskFilter('all');
    setCategoryFilter('all'); setDepartmentFilter('all'); setSiteFilter('all');
    setDateFrom(''); setDateTo('');
  };

  const columns: ColumnDef<HoldTimeMonitoringRecord>[] = [
    { key: 'holdTimeCode', header: 'Code', render: (r) => r.holdTimeCode || r.holdTimeId },
    { key: 'batchNumber', header: 'Batch' },
    { key: 'holdStage', header: 'Hold Stage' },
    { key: 'actualHoldTime', header: 'Actual', render: (r) => `${r.actualHoldTime} ${r.holdTimeUnit}` },
    { key: 'remainingTime', header: 'Remaining', render: (r) => (
      <span className={r.remainingTime <= 0 ? 'text-red-600 font-medium' : r.nearExpiry ? 'text-amber-600 font-medium' : ''}>
        {!r.endDateTime ? formatCountdown(r.remainingTime, r.holdTimeUnit) : `${r.remainingTime} ${r.holdTimeUnit}`}
      </span>
    ) },
    { key: 'timeUtilizationPercent', header: 'Util %', render: (r) => `${r.timeUtilizationPercent}%` },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/cpv/hold-time-monitoring/${r.id}`)} aria-label="View">
            <Eye className="h-4 w-4" />
          </Button>
          {!isReadOnly && (canCreate || canEdit) && (!r.isLocked || canReview) && (
            <Button variant="ghost" size="icon" onClick={() => {
              setEditing(r);
              setForm({ ...r, changeReason: '' });
              setFormProductId(r.cpvProductId);
              void onFormProductChange(r.cpvProductId);
              setComputedPreview(buildHoldTimeComputedFields(r));
              setFormOpen(true);
            }} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
          )}
          {canReview && r.reviewStatus === 'Draft' && (
            <Button variant="ghost" size="icon" onClick={async () => {
              const { error: err } = await reviewHoldTimeRecord(r.id, actor);
              if (err) toast.error(err); else { toast.success('Submitted for review'); await load(); }
            }} aria-label="Review"><CheckCircle className="h-4 w-4" /></Button>
          )}
          {canReview && r.reviewStatus === 'Under Review' && (
            <Button variant="ghost" size="sm" onClick={() => { setApproveTarget(r); setActionReason(''); }}>Approve</Button>
          )}
          {canReview && r.reviewStatus !== 'Approved' && (
            <Button variant="ghost" size="icon" onClick={() => { setDeleteTarget(r); setActionReason(''); }} aria-label="Archive">
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
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title="Hold Time Monitoring"
        description="Validated hold-time limits with live countdown, SPC, and Part 11 controls"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Hold Time Monitoring' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                downloadCsv(`hold-time-records-${new Date().toISOString().slice(0, 10)}.csv`,
                  ['ID', 'Code', 'Product', 'Batch', 'Stage', 'Category', 'Actual', 'Allowed', 'Remaining', 'Util%', 'Unit', 'Status', 'Risk', 'Temp', 'Humidity', 'Review'],
                  filtered.map((r) => [
                    r.holdTimeId, r.holdTimeCode, r.productName, r.batchNumber, r.holdStage, r.materialCategory,
                    r.actualHoldTime, r.allowedHoldTime, r.remainingTime, r.timeUtilizationPercent, r.holdTimeUnit,
                    r.status, r.riskLevel, r.temperature ?? '', r.humidity ?? '', r.reviewStatus,
                  ]));
                await logHoldTimeExport(actor, filtered.length);
                toast.success(`Exported ${filtered.length} records`);
              }}><Download className="h-4 w-4" />Export</Button>
            )}
            <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => printPage()}><Printer className="h-4 w-4" />Print</Button>
            {canCreate && (
              <>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => { setBulkOpen(true); setBulkRows([]); setBulkProductId(''); setBulkBatchId(''); }}>
                  <Layers className="h-4 w-4" />Bulk Entry
                </Button>
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
          { href: '/cpv/raw-material-monitoring', label: 'Raw Material' },
          { href: '/cpv/packing-material-monitoring', label: 'Packing Material' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : '/cpv/cpp', label: 'CPP' },
          { href: batchQuery ? `/cpv/cqa?batch=${encodeURIComponent(batchQuery)}` : '/cpv/cqa', label: 'CQA' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/trend-analysis', label: 'Trends' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Total Records" value={summary.total} />
        <KpiCard label="In Progress" value={summary.inProgress} tone="blue" />
        <KpiCard label="Compliant" value={summary.compliant} tone="green" />
        <KpiCard label="Near Expiry" value={summary.nearExpiry} tone="amber" />
        <KpiCard label="Exceeded / Expired" value={summary.exceeded + summary.expired} tone={summary.exceeded + summary.expired > 0 ? 'red' : 'blue'} />
        <KpiCard label="Storage Excursions" value={summary.storageExcursions} tone={summary.storageExcursions > 0 ? 'red' : 'green'} />
        <KpiCard label="High Risk" value={summary.highRisk} tone="amber" />
        <KpiCard label="Deviation Triggered" value={summary.deviationTriggered} />
        <KpiCard label="CAPA Suggested" value={summary.capaSuggested} />
        <KpiCard label="Mean Hold" value={spcStats.mean} />
        <KpiCard label="Std Dev" value={spcStats.stdDev} />
        <KpiCard label="Cpk" value={spcStats.cpk ?? '—'} tone="blue" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <CardTitle className="text-base">Hold Time Records</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              <Input placeholder="Search code, batch, product…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {HOLD_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {HOLD_TIME_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All risk</SelectItem>
                  {['Low', 'Medium', 'High', 'Critical'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {HOLD_MATERIAL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger><SelectValue placeholder="Site" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sites</SelectItem>
                  {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
              <Button variant="ghost" size="sm" className="gap-1" onClick={clearFilters}><FilterX className="h-4 w-4" />Clear</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length
            ? <ResponsiveDataTable columns={columns} data={filtered} pageSize={10} mobileTitleKey="batchNumber" mobileSubtitleKey="holdStage" />
            : <EmptyState title="No hold time records" message="Create a record to start monitoring hold times." />}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Stage-wise Hold Time</CardTitle>
            <Select value={trendStage} onValueChange={setTrendStage}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>{HOLD_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </CardHeader>
          <CardContent><ParameterTrendChart data={trendData} title={trendStage} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Compliance Trend</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.complianceTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.complianceTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="rate" stroke="#2563eb" name="Compliance %" />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No trend data" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Exceeded / Expired Trend</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.exceededTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.exceededTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis /><Tooltip />
                  <Bar dataKey="count" fill="#dc2626" name="Exceeded" />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No exceeded data" />}
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
        <Card>
          <CardHeader><CardTitle className="text-base">Time Utilization</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.utilizationTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.utilizationTrend.slice(-20)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis domain={[0, 'auto']} />
                  <Tooltip />
                  <Bar dataKey="utilization" fill="#7c3aed" name="Util %" />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No utilization data" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">SPC Summary</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <div>Mean: {spcStats.mean}</div>
            <div>Median: {spcStats.median}</div>
            <div>Std Dev: {spcStats.stdDev}</div>
            <div>Variance: {spcStats.variance}</div>
            <div>Cp: {spcStats.cp ?? '—'}</div>
            <div>Cpk: {spcStats.cpk ?? '—'}</div>
            <div>Pp: {spcStats.pp ?? '—'}</div>
            <div>Ppk: {spcStats.ppk ?? '—'}</div>
            <div>Sigma: {spcStats.sigmaLevel ?? '—'}</div>
            <div>n: {spcStats.count}</div>
          </CardContent>
        </Card>
      </div>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>{editing ? 'Edit Hold Time' : 'Create Hold Time Record'}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label>Product *</Label>
              <Select value={formProductId} onValueChange={onFormProductChange}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Batch *</Label>
              <Select value={form.batchNumber || ''} onValueChange={onFormBatchChange}>
                <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Hold Stage *</Label>
              <Select value={form.holdStage || HOLD_STAGES[0]} onValueChange={onHoldStageChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{HOLD_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Material Category</Label>
              <Select
                value={form.materialCategory || 'N/A'}
                onValueChange={(v) => setForm((f) => ({ ...f, materialCategory: v as HoldTimeMonitoringFormData['materialCategory'] }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{HOLD_MATERIAL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date Time *</Label>
                <Input type="datetime-local" value={form.startDateTime?.slice(0, 16) || ''} onChange={(e) => {
                  const next = { ...form, startDateTime: e.target.value };
                  setForm(next);
                  updateComputedPreview(next);
                }} />
              </div>
              <div>
                <Label>End Date Time</Label>
                <Input type="datetime-local" value={form.endDateTime?.slice(0, 16) || ''} onChange={(e) => {
                  const next = { ...form, endDateTime: e.target.value };
                  setForm(next);
                  updateComputedPreview(next);
                }} />
                <p className="text-xs text-muted-foreground mt-1">Leave blank for live countdown</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Allowed Hold Time *</Label>
                <Input type="number" value={form.allowedHoldTime ?? ''} onChange={(e) => {
                  const next = { ...form, allowedHoldTime: Number(e.target.value) };
                  setForm(next);
                  updateComputedPreview(next);
                }} />
              </div>
              <div>
                <Label>Unit *</Label>
                <Select value={form.holdTimeUnit || 'Hours'} onValueChange={(v) => {
                  const next = { ...form, holdTimeUnit: v as HoldTimeMonitoringFormData['holdTimeUnit'] };
                  setForm(next);
                  updateComputedPreview(next);
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{HOLD_TIME_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Study Number</Label><Input value={form.studyNumber || ''} onChange={(e) => setForm((f) => ({ ...f, studyNumber: e.target.value }))} /></div>
              <div><Label>Manufacturing Order</Label><Input value={form.manufacturingOrder || ''} onChange={(e) => setForm((f) => ({ ...f, manufacturingOrder: e.target.value }))} /></div>
              <div><Label>Department</Label><Input value={form.department || ''} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} /></div>
              <div><Label>Production Line</Label><Input value={form.productionLine || ''} onChange={(e) => setForm((f) => ({ ...f, productionLine: e.target.value }))} /></div>
              <div><Label>Site</Label><Input value={form.site || ''} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} /></div>
              <div><Label>Storage Location</Label><Input value={form.storageLocation || ''} onChange={(e) => setForm((f) => ({ ...f, storageLocation: e.target.value }))} /></div>
              <div><Label>Storage Condition</Label><Input value={form.storageCondition || ''} onChange={(e) => setForm((f) => ({ ...f, storageCondition: e.target.value }))} /></div>
              <div><Label>Equipment</Label><Input value={form.equipmentName || ''} onChange={(e) => setForm((f) => ({ ...f, equipmentName: e.target.value }))} /></div>
              <div><Label>Temperature</Label><Input type="number" value={form.temperature ?? ''} onChange={(e) => {
                const next = { ...form, temperature: e.target.value === '' ? undefined : Number(e.target.value) };
                setForm(next); updateComputedPreview(next);
              }} /></div>
              <div><Label>Humidity %</Label><Input type="number" value={form.humidity ?? ''} onChange={(e) => {
                const next = { ...form, humidity: e.target.value === '' ? undefined : Number(e.target.value) };
                setForm(next); updateComputedPreview(next);
              }} /></div>
            </div>
            {computedPreview && (
              <div className="rounded-md border bg-slate-50 p-3 text-sm space-y-1 dark:bg-slate-900">
                <p>Actual / Elapsed: {computedPreview.actualHoldTime}</p>
                <p>Remaining: {computedPreview.remainingTime} · Exceeded: {computedPreview.exceededTime}</p>
                <p>Utilization: {computedPreview.timeUtilizationPercent}%</p>
                <div>Status: <StatusBadge status={computedPreview.status} /></div>
                {computedPreview.storageExcursion && <p className="text-red-600">Storage condition excursion detected</p>}
              </div>
            )}
            <div><Label>Reason for Hold</Label><Textarea value={form.reasonForHold || ''} onChange={(e) => setForm((f) => ({ ...f, reasonForHold: e.target.value }))} /></div>
            <div><Label>Description</Label><Textarea value={form.description || ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div><Label>Remarks</Label><Textarea value={form.remarks || ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
            <div>
              <Label>Change Reason *</Label>
              <Textarea value={form.changeReason || ''} onChange={(e) => setForm((f) => ({ ...f, changeReason: e.target.value }))} placeholder="Minimum 5 characters (ALCOA+)" />
            </div>
            <Button className="w-full" disabled={submitting} onClick={() => void saveForm()}>
              {submitting ? 'Saving…' : 'Save Record'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bulk Hold Time Entry</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 mb-4">
            <div>
              <Label>Product</Label>
              <Select value={bulkProductId} onValueChange={(id) => void loadBulkRowsForProduct(id)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Batch</Label>
              <Select value={bulkBatchId} onValueChange={setBulkBatchId}>
                <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="mb-3"><Label>Change Reason *</Label><Textarea value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} /></div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Allowed</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bulkRows.map((row, idx) => (
                  <TableRow key={row.stage}>
                    <TableCell>{row.stage}</TableCell>
                    <TableCell>{row.allowed} {row.unit}</TableCell>
                    <TableCell>
                      <Input type="datetime-local" className="h-8" value={row.start.slice(0, 16)} onChange={(e) => {
                        const next = [...bulkRows];
                        next[idx] = { ...row, start: e.target.value };
                        setBulkRows(next);
                      }} />
                    </TableCell>
                    <TableCell>
                      <Input type="datetime-local" className="h-8" value={row.end.slice(0, 16)} onChange={(e) => {
                        const next = [...bulkRows];
                        next[idx] = { ...row, end: e.target.value };
                        setBulkRows(next);
                      }} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => void saveBulk()}>{submitting ? 'Saving…' : 'Save All'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(approveTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Hold Time Record</DialogTitle>
            <p className="text-sm text-muted-foreground">Change reason and electronic signature are required (Part 11 / ALCOA+).</p>
          </DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => {
              if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignAction('approve'); setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Hold Time Record</DialogTitle>
            <p className="text-sm text-muted-foreground">Soft-delete with change reason and electronic signature.</p>
          </DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={submitting} onClick={() => {
              if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignAction('delete'); setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Hold Time Monitoring"
        recordId={esignAction === 'approve' ? approveTarget?.id || '' : esignAction === 'delete' ? deleteTarget?.id || '' : editing?.id || ''}
        documentNumber={esignAction === 'approve' ? approveTarget?.holdTimeId || '' : esignAction === 'delete' ? deleteTarget?.holdTimeId || '' : editing?.holdTimeId || ''}
        actionType={esignAction === 'approve' ? 'Approve' : esignAction === 'delete' ? 'Soft Delete' : 'QA Override'}
        onSuccess={() => { void onEsignConfirm(); }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
