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
  summarizeUtilityRecords, buildUtilityChartSeries, UTILITY_TYPES, UTILITY_STATUSES, UTILITY_DATA_SOURCES,
  evaluateUtilityStatus, utilityMonitoringFormSchema,
  type UtilityMonitoringFormData, type UtilityMonitoringRecord,
} from '@/lib/cpv-utility-monitoring';
import {
  fetchUtilityRecords, fetchUtilityBatchesForProduct, fetchUtilityParameters, fetchUtilitySystems,
  createUtilityRecord, updateUtilityRecord, approveUtilityRecord, reviewUtilityRecord,
  bulkCreateUtilityRecords, logUtilityExport, softDeleteUtilityRecord,
  utilityParameterTrendData, buildUtilityExportRows,
  type UtilityActor,
} from '@/lib/cpv-utility-monitoring-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import type { Parameter } from '@/lib/admin/schemas';
import { normalizeParameter } from '@/lib/admin/parameter-service';
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';
import type { ColumnDef } from '@/components/admin/admin-data-table';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];

type UtilitySaveData = UtilityMonitoringFormData;
type EsignAction = 'approve' | 'delete' | 'qa-override';

async function callReview(id: string, actor: UtilityActor, changeReason = 'Submitted for QA review') {
  return reviewUtilityRecord(id, actor, changeReason);
}

async function callApprove(
  id: string,
  actor: UtilityActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return approveUtilityRecord(id, actor, changeReason, options);
}

async function callSoftDelete(
  id: string,
  actor: UtilityActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return softDeleteUtilityRecord(id, actor, changeReason, options);
}

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function UtilityTypeBadge({ type }: { type: string }) {
  return <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">{type}</span>;
}

function ComplianceBadges({ record }: { record: UtilityMonitoringRecord }) {
  const raw = record as Record<string, unknown>;
  const showOosFlag = Boolean(raw.oosRequired || raw.linkedOosNumber) && !['OOS', 'Excursion'].includes(record.status);
  return (
    <div className="flex flex-wrap gap-1">
      <StatusBadge status={record.status} />
      {showOosFlag && <StatusBadge status="OOS" />}
      {record.status === 'Action' && <StatusBadge status="OOT" />}
    </div>
  );
}

const defaultFormFields = (): Partial<UtilitySaveData> => ({
  changeReason: '',
  building: '',
  site: '',
  shift: '',
  productionLine: '',
  equipmentId: '',
  equipmentName: '',
  dataSource: 'Manual',
  sensorId: '',
  alarmStatus: '',
  communicationStatus: 'OK',
  specificationNumber: '',
  version: '1.0',
  effectiveDate: '',
  description: '',
  alertLimitLow: undefined,
  alertLimitHigh: undefined,
  actionLimitLow: undefined,
  actionLimitHigh: undefined,
});

export function UtilityMonitoringPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateUtility(role) && !cpvPermissions.isUtilityViewOnly(role);
  const canReview = cpvPermissions.canReviewUtility(role);
  const canImportExport = cpvPermissions.canImportExportUtility(role);
  const canQaOverride = cpvPermissions.canReviewUtility(role);
  const isReadOnly = cpvPermissions.isReadOnly(role) || cpvPermissions.isUtilityViewOnly(role);

  const [records, setRecords] = useState<UtilityMonitoringRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [systems, setSystems] = useState<Awaited<ReturnType<typeof fetchUtilitySystems>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<UtilityMonitoringRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<UtilityMonitoringRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UtilityMonitoringRecord | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<EsignAction>('approve');

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [productFilter, setProductFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [buildingFilter, setBuildingFilter] = useState('all');
  const [trendParam, setTrendParam] = useState('WFI Conductivity');

  const [formProductId, setFormProductId] = useState('');
  const [formBatches, setFormBatches] = useState<Awaited<ReturnType<typeof fetchUtilityBatchesForProduct>>>([]);
  const [formParams, setFormParams] = useState<Parameter[]>([]);
  const [form, setForm] = useState<Partial<UtilitySaveData>>(defaultFormFields());

  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkBatchId, setBulkBatchId] = useState('');
  const [bulkUtilityType, setBulkUtilityType] = useState<string>(UTILITY_TYPES[0]);
  const [bulkSystemId, setBulkSystemId] = useState('');
  const [bulkSamplingPoint, setBulkSamplingPoint] = useState('');
  const [bulkReason, setBulkReason] = useState('Bulk utility entry');
  const [bulkRows, setBulkRows] = useState<Array<{ param: Parameter; observed: string; remarks: string }>>([]);

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' };
  const now = new Date();
  const defaultDate = now.toISOString().split('T')[0];
  const defaultTime = now.toTimeString().slice(0, 5);

  useEffect(() => {
    if (productQuery) setSearch(productQuery);
    else if (batchQuery) setSearch(batchQuery);
  }, [productQuery, batchQuery]);

  useEffect(() => {
    if (batchQuery) setBatchFilter(batchQuery);
  }, [batchQuery]);

  useEffect(() => {
    if (productQuery) setProductFilter(productQuery);
  }, [productQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods, sys] = await Promise.all([
        fetchUtilityRecords(), fetchProducts(), fetchUtilitySystems(),
      ]);
      setRecords(rows);
      setProducts(prods);
      setSystems(sys);
    } catch {
      setError('Failed to load utility records.');
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
      if (typeFilter !== 'all' && r.utilityType !== typeFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (buildingFilter !== 'all' && (r.building || '') !== buildingFilter) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q) || r.productCode.toLowerCase().includes(q)
        || r.batchNumber.toLowerCase().includes(q)
        || r.utilitySystemName.toLowerCase().includes(q) || r.samplingPoint.toLowerCase().includes(q)
        || r.parameterName.toLowerCase().includes(q) || (r.building || '').toLowerCase().includes(q);
    });
  }, [records, search, productFilter, batchFilter, typeFilter, statusFilter, riskFilter, buildingFilter]);

  const clearFilters = () => {
    setSearch('');
    setProductFilter('all');
    setBatchFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setRiskFilter('all');
    setBuildingFilter('all');
  };

  const summary = useMemo(() => summarizeUtilityRecords(records), [records]);
  const charts = useMemo(() => buildUtilityChartSeries(filtered), [filtered]);
  const trendData = useMemo(() => utilityParameterTrendData(filtered, trendParam), [filtered, trendParam]);
  const productNames = useMemo(() => Array.from(new Set(records.map((r) => r.productName))), [records]);
  const batchNumbers = useMemo(() => Array.from(new Set(records.map((r) => r.batchNumber))), [records]);
  const buildingNames = useMemo(() => Array.from(new Set(records.map((r) => r.building).filter(Boolean))) as string[], [records]);

  const crossLinks = useMemo(() => [
    ...(productQuery
      ? [{ href: `/cpv/product-master?search=${encodeURIComponent(productQuery)}`, label: 'Product Master' }]
      : [{ href: '/cpv/product-master', label: 'Product Master' }]),
    ...(batchQuery
      ? [{ href: `/cpv/batch-registration?search=${encodeURIComponent(batchQuery)}`, label: 'Batch' }]
      : [{ href: '/cpv/batch-registration', label: 'Batch' }]),
    { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
    { href: batchQuery ? `/cpv/cqa?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cqa?product=${encodeURIComponent(productQuery)}` : '/cpv/cqa', label: 'CQA' },
    { href: '/cpv/environmental-monitoring', label: 'Environmental' },
    { href: '/qms/equipment', label: 'Equipment' },
    { href: '/qms/equipment/calibration-schedule', label: 'Calibration' },
    { href: '/qms/equipment/preventive-maintenance', label: 'Maintenance' },
    { href: '/qms/deviation', label: 'Deviation' },
    { href: '/qms/capa', label: 'CAPA' },
    { href: '/cpv/risk-assessment', label: 'Risk Management' },
    { href: '/admin/audit-trail', label: 'Audit Trail' },
    { href: '/cpv/reports-analytics', label: 'Reports' },
    { href: '/cpv/statistical-process-control', label: 'SPC' },
    { href: '/cpv/trend-analysis', label: 'Trends' },
  ], [productQuery, batchQuery]);

  const formStatus = useMemo(() => {
    if (!form.observedValue || form.lowerLimit === undefined || form.upperLimit === undefined) return '';
    return evaluateUtilityStatus(
      form.observedValue,
      Number(form.lowerLimit),
      Number(form.upperLimit),
      form.resultType || 'Numeric',
      form.alertLimitLow,
      form.alertLimitHigh,
      form.actionLimitLow,
      form.actionLimitHigh,
    );
  }, [form]);

  const onFormProductChange = async (productId: string) => {
    setFormProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setForm((f) => ({ ...f, cpvProductId: productId, productName: p.productName, productCode: p.productCode }));
    const [batches, params] = await Promise.all([
      fetchUtilityBatchesForProduct(p.productName),
      fetchUtilityParameters(form.utilityType),
    ]);
    setFormBatches(batches);
    setFormParams(params);
  };

  const onUtilityTypeChange = async (utilityType: UtilityMonitoringFormData['utilityType']) => {
    setForm((f) => ({ ...f, utilityType }));
    const params = await fetchUtilityParameters(utilityType);
    setFormParams(params);
  };

  const onSystemChange = (systemId: string) => {
    const sys = systems.find((s) => s.id === systemId);
    if (!sys) return;
    setForm((f) => ({
      ...f,
      utilitySystemName: sys.name,
      utilitySystemCode: sys.code,
      utilityType: sys.utilityType as UtilityMonitoringFormData['utilityType'],
      areaRoomNo: sys.areaRoomNo,
      department: sys.department,
      samplingPoint: sys.samplingPoints[0] || '',
      equipmentId: sys.code,
      equipmentName: sys.name,
    }));
    void onUtilityTypeChange(sys.utilityType as UtilityMonitoringFormData['utilityType']);
  };

  const onFormParamChange = (paramId: string) => {
    const p = formParams.find((x) => x.id === paramId);
    if (!p) return;
    const n = normalizeParameter(p);
    setForm((f) => ({
      ...f,
      parameterId: paramId,
      parameterCode: n.parameterCode,
      parameterName: n.parameterName,
      lowerLimit: Number(n.lsl || n.lowerLimit) || 0,
      upperLimit: Number(n.usl || n.upperLimit) || 0,
      targetValue: Number(n.target || n.targetValue) || 0,
      unit: n.unit,
      resultType: (n.resultType as UtilityMonitoringFormData['resultType']) || 'Numeric',
      utilityCriticality: n.criticality || 'Major',
      autoDeviationRequired: Boolean(n.autoDeviationRequired),
      alertLimitLow: n.alertLimitLow ? Number(n.alertLimitLow) : undefined,
      alertLimitHigh: n.alertLimitHigh ? Number(n.alertLimitHigh) : undefined,
      actionLimitLow: n.actionLimitLow ? Number(n.actionLimitLow) : undefined,
      actionLimitHigh: n.actionLimitHigh ? Number(n.actionLimitHigh) : undefined,
    }));
  };

  const resolveProductIdFromQuery = useCallback(() => {
    if (!productQuery) return '';
    const match = products.find((p) => p.productCode === productQuery || p.productName === productQuery);
    return match?.id || '';
  }, [productQuery, products]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...defaultFormFields(),
      monitoringDate: defaultDate,
      monitoringTime: defaultTime,
      recordedBy: profile?.full_name || '',
      utilityType: UTILITY_TYPES[0],
      resultType: 'Numeric',
      autoDeviationRequired: true,
      dataSource: 'Manual',
    });
    const preselectId = resolveProductIdFromQuery();
    if (preselectId) void onFormProductChange(preselectId);
    setFormOpen(true);
  };

  const parseFormData = (): UtilitySaveData | null => {
    const parsed = utilityMonitoringFormSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || 'Validation failed');
      return null;
    }
    return parsed.data;
  };

  const saveForm = async () => {
    const data = parseFormData();
    if (!data) return;

    const qaOverride = Boolean(editing?.isLocked && editing.reviewStatus === 'Approved' && canQaOverride);
    if (qaOverride) {
      setEsignAction('qa-override');
      setEsignOpen(true);
      return;
    }

    setSubmitting(true);
    if (editing) {
      const { error: err } = await updateUtilityRecord(editing.id, data, actor, editing, false);
      if (err) toast.error(err);
      else { toast.success('Record updated'); setFormOpen(false); await load(); }
    } else {
      const { error: err } = await createUtilityRecord(data, actor);
      if (err) toast.error(err);
      else { toast.success('Record created'); setFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const applyQaOverride = async () => {
    const data = parseFormData();
    if (!data || !editing) return;
    setSubmitting(true);
    const { error: err } = await updateUtilityRecord(
      editing.id,
      data,
      actor,
      editing,
      true,
      { esignConfirmed: true },
    );
    setSubmitting(false);
    setEsignOpen(false);
    if (err) toast.error(err);
    else {
      toast.success('Record updated (QA override)');
      setFormOpen(false);
      await load();
    }
  };

  const confirmApprove = () => {
    if (!approveTarget) return;
    if (actionReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setEsignAction('approve');
    setEsignOpen(true);
  };

  const applyApprove = async () => {
    if (!approveTarget) return;
    setSubmitting(true);
    const { error: err } = await callApprove(approveTarget.id, actor, actionReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setApproveTarget(null);
    setActionReason('');
    if (err) toast.error(err);
    else {
      toast.success('Record approved');
      await load();
    }
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (actionReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setEsignAction('delete');
    setEsignOpen(true);
  };

  const applyDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    const { error: err } = await callSoftDelete(deleteTarget.id, actor, actionReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setDeleteTarget(null);
    setActionReason('');
    if (err) toast.error(err);
    else {
      toast.success('Record soft-deleted');
      await load();
    }
  };

  const openBulk = async () => {
    const preselectId = resolveProductIdFromQuery() || products[0]?.id;
    if (!preselectId) return;
    setBulkProductId(preselectId);
    const p = products.find((x) => x.id === preselectId);
    if (p) setFormBatches(await fetchUtilityBatchesForProduct(p.productName));
    const params = await fetchUtilityParameters(bulkUtilityType);
    setBulkRows(params.slice(0, 8).map((param) => ({ param, observed: '', remarks: '' })));
    if (systems[0]) {
      setBulkSystemId(systems[0].id);
      setBulkSamplingPoint(systems[0].samplingPoints[0] || '');
    }
    setBulkOpen(true);
  };

  const saveBulk = async () => {
    const p = products.find((x) => x.id === bulkProductId);
    const batch = formBatches.find((b) => b.id === bulkBatchId);
    const sys = systems.find((s) => s.id === bulkSystemId);
    if (!p || !batch || !sys) { toast.error('Select product, batch and utility system'); return; }
    if (bulkReason.trim().length < 5) {
      toast.error('Bulk change reason must be at least 5 characters');
      return;
    }
    const rows: UtilityMonitoringFormData[] = bulkRows.filter((r) => r.observed).map((row) => {
      const n = normalizeParameter(row.param);
      return {
        cpvProductId: bulkProductId,
        productName: p.productName,
        productCode: p.productCode,
        batchNumber: batch.batchNumber,
        utilityType: bulkUtilityType as UtilityMonitoringFormData['utilityType'],
        utilitySystemName: sys.name,
        utilitySystemCode: sys.code,
        samplingPoint: bulkSamplingPoint,
        areaRoomNo: sys.areaRoomNo,
        building: '',
        site: '',
        department: sys.department,
        shift: '',
        productionLine: '',
        equipmentId: sys.code,
        equipmentName: sys.name,
        dataSource: 'Manual' as const,
        sensorId: '',
        alarmStatus: '',
        communicationStatus: 'OK',
        parameterId: row.param.id || '',
        parameterCode: n.parameterCode,
        parameterName: n.parameterName,
        observedValue: Number(row.observed),
        targetValue: Number(n.target || n.targetValue) || undefined,
        lowerLimit: Number(n.lsl) || 0,
        upperLimit: Number(n.usl) || 0,
        unit: n.unit,
        resultType: (n.resultType as UtilityMonitoringFormData['resultType']) || 'Numeric',
        monitoringDate: defaultDate,
        monitoringTime: defaultTime,
        recordedBy: profile?.full_name || '',
        reviewedBy: '',
        reviewDate: '',
        remarks: row.remarks,
        utilityCriticality: n.criticality || 'Major',
        autoDeviationRequired: Boolean(n.autoDeviationRequired),
        specificationNumber: '',
        version: '1.0',
        effectiveDate: '',
        description: '',
        changeReason: bulkReason,
      };
    });
    if (!rows.length) { toast.error('Enter at least one observed value'); return; }
    setSubmitting(true);
    const { created, errors } = await bulkCreateUtilityRecords(rows, actor, bulkReason);
    setSubmitting(false);
    if (errors.length) toast.error(errors[0]);
    toast.success(`${created} utility records saved`);
    setBulkOpen(false);
    await load();
  };

  const columns: ColumnDef<UtilityMonitoringRecord>[] = [
    { key: 'batchNumber', header: 'Batch' },
    { key: 'utilityType', header: 'Utility', render: (r) => <UtilityTypeBadge type={r.utilityType} /> },
    { key: 'parameterName', header: 'Parameter' },
    { key: 'samplingPoint', header: 'Point' },
    { key: 'observedValue', header: 'Value' },
    { key: 'status', header: 'Status', render: (r) => <ComplianceBadges record={r} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'reviewStatus', header: 'Review' },
  ];

  const esignRecord = esignAction === 'approve' ? approveTarget : esignAction === 'delete' ? deleteTarget : editing;
  const esignDocNo = esignRecord?.utilityMonitoringId || '';
  const esignRecordId = esignRecord?.id || '';

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="Utility Monitoring"
        description="Monitor critical utilities such as WFI, purified water, compressed air, nitrogen, clean steam and HVAC for CPV"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Utility Monitoring' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2 no-print" onClick={async () => {
                const { headers, rows } = buildUtilityExportRows(filtered);
                downloadCsv(`utility-monitoring-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
                await logUtilityExport(actor, filtered.length);
                toast.success(`Exported ${filtered.length} utility records`);
              }}>
                <Download className="h-4 w-4" />Export
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => printPage()}>
              <Printer className="h-4 w-4" />Print
            </Button>
            {canCreate && !isReadOnly && (
              <>
                <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => void openBulk()}><Layers className="h-4 w-4" />Bulk Entry</Button>
                <Button size="sm" className="gap-2 no-print" onClick={openCreate}><Plus className="h-4 w-4" />New Record</Button>
              </>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {crossLinks.map((l) => (
          <Link
            key={l.href + l.label}
            href={l.href}
            className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            {l.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        <KpiCard label="Total Records" value={summary.total} tone="blue" />
        <KpiCard label="Compliant" value={summary.compliant} tone="green" />
        <KpiCard label="Alert" value={summary.alert} tone="amber" />
        <KpiCard label="Action" value={summary.action} tone="amber" />
        <KpiCard label="Excursion" value={summary.excursion} tone="red" />
        <KpiCard label="Critical Excursions" value={summary.criticalExcursions} tone="red" />
        <KpiCard label="Deviation" value={summary.deviationTriggered} tone="amber" />
        <KpiCard label="WFI Alerts" value={summary.wfiAlerts} tone="blue" />
        <KpiCard label="HVAC Alerts" value={summary.hvacAlerts} tone="blue" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Compliance Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.complianceTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.complianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis domain={[0, 100]} /><Tooltip />
                  <Line type="monotone" dataKey="rate" stroke={CHART_COLORS[0]} strokeWidth={2} /></LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No compliance data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Utility Type Excursions</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.utilityTypeExcursionTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.utilityTypeExcursionTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="type" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[1]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No excursion data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Sampling Point Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.samplingPointTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.samplingPointTrend} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="point" type="category" width={90} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[2]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No sampling point data" />}
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
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">WFI Conductivity</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.wfiConductivityTrend.length ? <ParameterTrendChart data={charts.wfiConductivityTrend} /> : <EmptyState title="No WFI conductivity data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Compressed Air Pressure</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.compressedAirPressureTrend.length ? <ParameterTrendChart data={charts.compressedAirPressureTrend} /> : <EmptyState title="No compressed air data" />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Parameter Trend</CardTitle>
          <Select value={trendParam} onValueChange={setTrendParam}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['WFI Conductivity', 'WFI TOC', 'Compressed Air Pressure', 'HVAC Temperature', 'Differential Pressure'].map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="h-[240px]">
          {trendData.length ? <ParameterTrendChart data={trendData} /> : <EmptyState title="No trend data for selected parameter" />}
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
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue placeholder="Utility Type" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Types</SelectItem>{UTILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Status</SelectItem>{UTILITY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Risk</SelectItem>{['Low', 'Medium', 'High', 'Critical'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={buildingFilter} onValueChange={setBuildingFilter}><SelectTrigger><SelectValue placeholder="Building" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Buildings</SelectItem>{buildingNames.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
            <Button variant="outline" size="sm" className="gap-1" onClick={clearFilters}><FilterX className="h-3.5 w-3.5" />Clear</Button>
          </div>
          {filtered.length === 0 ? <EmptyState title="No utility records" /> : (
            <ResponsiveDataTable
              columns={columns}
              data={filtered}
              pageSize={10}
              onRowClick={(r) => router.push(`/cpv/utility-monitoring/${r.id}`)}
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => router.push(`/cpv/utility-monitoring/${row.id}`)}><Eye className="h-4 w-4" /></Button>
                  {canCreate && !isReadOnly && (!row.isLocked || canQaOverride) && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(row);
                      setForm({ ...row, changeReason: '' });
                      setFormProductId(row.cpvProductId);
                      void onFormProductChange(row.cpvProductId);
                      setFormOpen(true);
                    }}><Pencil className="h-4 w-4" /></Button>
                  )}
                  {canReview && row.reviewStatus === 'Draft' && (
                    <Button size="icon" variant="ghost" onClick={async () => {
                      const { error: err } = await callReview(row.id, actor);
                      if (err) toast.error(err);
                      else { toast.success('Submitted for review'); await load(); }
                    }}><CheckCircle className="h-4 w-4" /></Button>
                  )}
                  {canReview && (row.reviewStatus === 'Under Review' || row.reviewStatus === 'Draft') && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setApproveTarget(row);
                      setActionReason('');
                      setEsignAction('approve');
                    }}>Approve</Button>
                  )}
                  {canReview && row.reviewStatus !== 'Approved' && !row.isDeleted && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      setDeleteTarget(row);
                      setActionReason('');
                      setEsignAction('delete');
                    }}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  )}
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>{editing ? 'Edit Utility Record' : 'New Utility Record'}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-3">
            {editing?.isLocked && canQaOverride && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Record is locked. Saving will require QA override and electronic signature.
              </div>
            )}
            {!editing && (
              <div><Label>CPV Product *</Label>
                <Select value={formProductId} onValueChange={(v) => void onFormProductChange(v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Batch *</Label>
              <Select value={form.batchNumber || ''} onValueChange={(v) => setForm((f) => ({ ...f, batchNumber: v }))} disabled={Boolean(editing?.isLocked && !canQaOverride)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Utility Type *</Label>
              <Select value={form.utilityType || UTILITY_TYPES[0]} onValueChange={(v) => void onUtilityTypeChange(v as UtilityMonitoringFormData['utilityType'])}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{UTILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Utility System *</Label>
              <Select value={systems.find((s) => s.name === form.utilitySystemName)?.id || ''} onValueChange={onSystemChange}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{systems.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Sampling Point *</Label>
              <Select value={form.samplingPoint || ''} onValueChange={(v) => setForm((f) => ({ ...f, samplingPoint: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(systems.find((s) => s.name === form.utilitySystemName)?.samplingPoints || [form.samplingPoint || 'Main']).map((sp) => (
                    <SelectItem key={sp} value={sp}>{sp}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Parameter *</Label>
              <Select value={form.parameterId || ''} onValueChange={onFormParamChange} disabled={Boolean(editing)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{formParams.map((p) => <SelectItem key={p.id} value={p.id || ''}>{p.parameterName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Observed *</Label><Input className="mt-1" value={String(form.observedValue ?? '')} onChange={(e) => setForm((f) => ({ ...f, observedValue: e.target.value }))} /></div>
              <div><Label>Unit *</Label><Input className="mt-1" value={form.unit || ''} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} /></div>
              <div><Label>LSL</Label><Input className="mt-1" type="number" value={form.lowerLimit ?? ''} onChange={(e) => setForm((f) => ({ ...f, lowerLimit: Number(e.target.value) }))} /></div>
              <div><Label>USL</Label><Input className="mt-1" type="number" value={form.upperLimit ?? ''} onChange={(e) => setForm((f) => ({ ...f, upperLimit: Number(e.target.value) }))} /></div>
              <div><Label>Alert Low</Label><Input className="mt-1" type="number" value={form.alertLimitLow ?? ''} onChange={(e) => setForm((f) => ({ ...f, alertLimitLow: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Alert High</Label><Input className="mt-1" type="number" value={form.alertLimitHigh ?? ''} onChange={(e) => setForm((f) => ({ ...f, alertLimitHigh: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Action Low</Label><Input className="mt-1" type="number" value={form.actionLimitLow ?? ''} onChange={(e) => setForm((f) => ({ ...f, actionLimitLow: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Action High</Label><Input className="mt-1" type="number" value={form.actionLimitHigh ?? ''} onChange={(e) => setForm((f) => ({ ...f, actionLimitHigh: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Date *</Label><Input className="mt-1" type="date" value={form.monitoringDate || ''} onChange={(e) => setForm((f) => ({ ...f, monitoringDate: e.target.value }))} /></div>
              <div><Label>Time *</Label><Input className="mt-1" type="time" value={form.monitoringTime || ''} onChange={(e) => setForm((f) => ({ ...f, monitoringTime: e.target.value }))} /></div>
              <div><Label>Building</Label><Input className="mt-1" value={form.building || ''} onChange={(e) => setForm((f) => ({ ...f, building: e.target.value }))} /></div>
              <div><Label>Site</Label><Input className="mt-1" value={form.site || ''} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} /></div>
              <div><Label>Area / Room</Label><Input className="mt-1" value={form.areaRoomNo || ''} onChange={(e) => setForm((f) => ({ ...f, areaRoomNo: e.target.value }))} /></div>
              <div><Label>Production Line</Label><Input className="mt-1" value={form.productionLine || ''} onChange={(e) => setForm((f) => ({ ...f, productionLine: e.target.value }))} /></div>
              <div><Label>Department</Label><Input className="mt-1" value={form.department || ''} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} /></div>
              <div><Label>Shift</Label><Input className="mt-1" value={form.shift || ''} onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))} /></div>
              <div><Label>Equipment ID</Label><Input className="mt-1" value={form.equipmentId || ''} onChange={(e) => setForm((f) => ({ ...f, equipmentId: e.target.value }))} /></div>
              <div><Label>Equipment Name</Label><Input className="mt-1" value={form.equipmentName || ''} onChange={(e) => setForm((f) => ({ ...f, equipmentName: e.target.value }))} /></div>
              <div><Label>Data Source</Label>
                <Select value={form.dataSource || 'Manual'} onValueChange={(v) => setForm((f) => ({ ...f, dataSource: v as UtilityMonitoringFormData['dataSource'] }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{UTILITY_DATA_SOURCES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Sensor ID</Label><Input className="mt-1" value={form.sensorId || ''} onChange={(e) => setForm((f) => ({ ...f, sensorId: e.target.value }))} /></div>
              <div><Label>Alarm Status</Label><Input className="mt-1" value={form.alarmStatus || ''} onChange={(e) => setForm((f) => ({ ...f, alarmStatus: e.target.value }))} placeholder="Normal / Active" /></div>
              <div><Label>Communication</Label>
                <Select value={form.communicationStatus || 'OK'} onValueChange={(v) => setForm((f) => ({ ...f, communicationStatus: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['OK', 'Degraded', 'Disconnected', 'Failed'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Spec Number</Label><Input className="mt-1" value={form.specificationNumber || ''} onChange={(e) => setForm((f) => ({ ...f, specificationNumber: e.target.value }))} /></div>
              <div><Label>Version</Label><Input className="mt-1" value={form.version || '1.0'} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))} /></div>
              <div><Label>Effective Date</Label><Input className="mt-1" type="date" value={form.effectiveDate || ''} onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))} /></div>
              <div><Label>Recorded By *</Label><Input className="mt-1" value={form.recordedBy || ''} onChange={(e) => setForm((f) => ({ ...f, recordedBy: e.target.value }))} /></div>
              <div><Label>Status (auto)</Label><div className="mt-2">{formStatus ? <StatusBadge status={formStatus} /> : '—'}</div></div>
            </div>
            <div><Label>Description</Label><Textarea className="mt-1" value={form.description || ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div><Label>Remarks</Label><Textarea className="mt-1" value={form.remarks || ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
            <div><Label>Change Reason *</Label>
              <Textarea
                className="mt-1"
                value={form.changeReason || ''}
                onChange={(e) => setForm((f) => ({ ...f, changeReason: e.target.value }))}
                placeholder="Minimum 5 characters (ALCOA+)"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={() => void saveForm()} disabled={submitting}>Save</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bulk Utility Entry</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 py-2">
            <Select value={bulkProductId} onValueChange={async (v) => {
              setBulkProductId(v);
              const p = products.find((x) => x.id === v);
              if (p) setFormBatches(await fetchUtilityBatchesForProduct(p.productName));
            }}>
              <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={bulkBatchId} onValueChange={setBulkBatchId}>
              <SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={bulkUtilityType} onValueChange={async (v) => {
              setBulkUtilityType(v);
              const params = await fetchUtilityParameters(v);
              setBulkRows(params.slice(0, 8).map((param) => ({ param, observed: '', remarks: '' })));
            }}>
              <SelectTrigger><SelectValue placeholder="Utility Type" /></SelectTrigger>
              <SelectContent>{UTILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={bulkSystemId} onValueChange={(v) => {
              setBulkSystemId(v);
              const sys = systems.find((s) => s.id === v);
              if (sys) setBulkSamplingPoint(sys.samplingPoints[0] || '');
            }}>
              <SelectTrigger><SelectValue placeholder="Utility System" /></SelectTrigger>
              <SelectContent>{systems.filter((s) => s.utilityType === bulkUtilityType || bulkUtilityType === 'Other').map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}</SelectContent>
            </Select>
            <Select value={bulkSamplingPoint} onValueChange={setBulkSamplingPoint}>
              <SelectTrigger><SelectValue placeholder="Sampling Point" /></SelectTrigger>
              <SelectContent>
                {(systems.find((s) => s.id === bulkSystemId)?.samplingPoints || []).map((sp) => (
                  <SelectItem key={sp} value={sp}>{sp}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Change Reason *</Label>
            <Textarea className="mt-1" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} />
          </div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Parameter</TableHead><TableHead>Limits</TableHead><TableHead>Unit</TableHead><TableHead>Observed</TableHead><TableHead>Remarks</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {bulkRows.map((row, i) => {
                const n = normalizeParameter(row.param);
                return (
                  <TableRow key={row.param.id || i}>
                    <TableCell>{n.parameterName}</TableCell>
                    <TableCell className="text-xs">{n.lsl} – {n.usl}</TableCell>
                    <TableCell>{n.unit}</TableCell>
                    <TableCell><Input value={row.observed} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, observed: e.target.value } : r))} /></TableCell>
                    <TableCell><Input value={row.remarks} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, remarks: e.target.value } : r))} /></TableCell>
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
          <DialogHeader>
            <DialogTitle>Approve Utility Record</DialogTitle>
            <DialogDescription>Change reason and electronic signature required (Part 11 / ALCOA+).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button disabled={submitting} onClick={confirmApprove}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft-Delete Utility Record</DialogTitle>
            <DialogDescription>Archive this record with change reason and electronic signature.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={submitting} onClick={confirmDelete}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Utility Monitoring"
        recordId={esignRecordId}
        documentNumber={esignDocNo}
        actionType={esignAction === 'approve' ? 'Approve' : esignAction === 'delete' ? 'Soft Delete' : 'QA Override'}
        onSuccess={() => {
          if (esignAction === 'approve') void applyApprove();
          else if (esignAction === 'delete') void applyDelete();
          else void applyQaOverride();
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
