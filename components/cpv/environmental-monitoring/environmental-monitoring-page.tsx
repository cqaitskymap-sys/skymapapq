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
  summarizeEnvironmentalRecords, buildEnvironmentalChartSeries, CLEANROOM_GRADES,
  EM_MONITORING_TYPES, EM_PROCESS_STAGES, EM_STATUSES,
  environmentalMonitoringFormSchema,
  type EnvironmentalMonitoringFormData, type EnvironmentalMonitoringRecord,
} from '@/lib/cpv-environmental-monitoring';
import {
  fetchEnvironmentalRecords, fetchEmBatchesForProduct, fetchEnvironmentalParameters, fetchAreaOptions,
  createEnvironmentalRecord, updateEnvironmentalRecord, approveEnvironmentalRecord, reviewEnvironmentalRecord,
  bulkCreateEnvironmentalRecords, logEnvironmentalExport, environmentalParameterTrendData, softDeleteEnvironmentalRecord,
} from '@/lib/cpv-environmental-monitoring-service';
import type { AreaRecord } from '@/lib/monitoring-mgmt-types';
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
import type { ColumnDef } from '@/components/admin/admin-data-table';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];
type EsignAction = 'approve' | 'delete' | 'qa-override';
type EnvironmentalSaveData = EnvironmentalMonitoringFormData;

const defaultFormFields = (): Partial<EnvironmentalSaveData> => ({
  building: '', block: '', floor: '', site: '', department: '', shift: '', zone: '',
  ahuId: '', ahuName: '', isoClass: 'N/A', dataSource: 'Manual', sensorId: '',
  alarmStatus: '', communicationStatus: 'OK', equipmentId: '', equipmentName: '',
  specificationNumber: '', version: '1.0', effectiveDate: '', description: '',
  changeReason: '', monitoringPointCode: '', monitoringPointName: '',
  alertLimitLow: undefined, alertLimitHigh: undefined, actionLimitLow: undefined, actionLimitHigh: undefined,
});

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function GradeBadge({ grade }: { grade: string }) {
  const critical = ['Grade A', 'Grade B'].includes(grade);
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${critical ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>{grade}</span>;
}

export function EnvironmentalMonitoringPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canCreateEnvironmental(role) && !cpvPermissions.isEnvironmentalViewOnly(role);
  const canReview = cpvPermissions.canReviewEnvironmental(role);
  const canImportExport = cpvPermissions.canImportExportEnvironmental(role);
  const canQaOverride = cpvPermissions.canReviewEnvironmental(role);
  const isReadOnly = cpvPermissions.isReadOnly(role) || cpvPermissions.isEnvironmentalViewOnly(role);

  const [records, setRecords] = useState<EnvironmentalMonitoringRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [areas, setAreas] = useState<AreaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<EnvironmentalMonitoringRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<EnvironmentalMonitoringRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnvironmentalMonitoringRecord | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<EsignAction>('approve');

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [productFilter, setProductFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [buildingFilter, setBuildingFilter] = useState('all');
  const [trendParam, setTrendParam] = useState('Room Temperature');

  const [formProductId, setFormProductId] = useState('');
  const [formBatches, setFormBatches] = useState<Awaited<ReturnType<typeof fetchEmBatchesForProduct>>>([]);
  const [formParams, setFormParams] = useState<Parameter[]>([]);
  const [form, setForm] = useState<Partial<EnvironmentalSaveData>>(defaultFormFields());

  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkBatchId, setBulkBatchId] = useState('');
  const [bulkAreaId, setBulkAreaId] = useState('');
  const [bulkMonitoringType, setBulkMonitoringType] = useState<string>(EM_MONITORING_TYPES[0]);
  const [bulkReason, setBulkReason] = useState('Bulk environmental entry');
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
    if (productQuery) setProductFilter(productQuery);
    if (batchQuery) setBatchFilter(batchQuery);
  }, [productQuery, batchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods, areaList] = await Promise.all([
        fetchEnvironmentalRecords(), fetchProducts(), fetchAreaOptions(),
      ]);
      setRecords(rows);
      setProducts(prods);
      setAreas(areaList);
    } catch {
      setError('Failed to load environmental records.');
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
      if (gradeFilter !== 'all' && r.cleanroomGrade !== gradeFilter) return false;
      if (typeFilter !== 'all' && r.monitoringType !== typeFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (buildingFilter !== 'all' && (r.building || '') !== buildingFilter) return false;
      if (!q) return true;
      return r.productName.toLowerCase().includes(q) || r.productCode.toLowerCase().includes(q) || r.batchNumber.toLowerCase().includes(q)
        || r.areaName.toLowerCase().includes(q) || r.roomNumber.toLowerCase().includes(q)
        || r.parameterName.toLowerCase().includes(q) || (r.building || '').toLowerCase().includes(q);
    });
  }, [records, search, productFilter, batchFilter, gradeFilter, typeFilter, statusFilter, riskFilter, buildingFilter]);

  const clearFilters = () => {
    setSearch(''); setProductFilter('all'); setBatchFilter('all'); setGradeFilter('all');
    setTypeFilter('all'); setStatusFilter('all'); setRiskFilter('all'); setBuildingFilter('all');
  };

  const summary = useMemo(() => summarizeEnvironmentalRecords(records), [records]);
  const charts = useMemo(() => buildEnvironmentalChartSeries(filtered), [filtered]);
  const trendData = useMemo(() => environmentalParameterTrendData(filtered, trendParam), [filtered, trendParam]);
  const productNames = useMemo(() => Array.from(new Set(records.map((r) => r.productName))), [records]);
  const batchNumbers = useMemo(() => Array.from(new Set(records.map((r) => r.batchNumber))), [records]);
  const buildingNames = useMemo(() => Array.from(new Set(records.map((r) => r.building).filter(Boolean))) as string[], [records]);
  const crossLinks = useMemo(() => [
    { href: productQuery ? `/cpv/product-master?search=${encodeURIComponent(productQuery)}` : '/cpv/product-master', label: 'Product Master' },
    { href: batchQuery ? `/cpv/batch-registration?search=${encodeURIComponent(batchQuery)}` : '/cpv/batch-registration', label: 'Batch' },
    { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
    { href: batchQuery ? `/cpv/cqa?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cqa?product=${encodeURIComponent(productQuery)}` : '/cpv/cqa', label: 'CQA' },
    { href: '/cpv/utility-monitoring', label: 'Utility' }, { href: '/qms/equipment', label: 'Equipment' },
    { href: '/qms/equipment/calibration-schedule', label: 'Calibration' }, { href: '/qms/equipment/preventive-maintenance', label: 'Maintenance' },
    { href: '/qms/deviation', label: 'Deviation' }, { href: '/qms/capa', label: 'CAPA' },
    { href: '/cpv/risk-assessment', label: 'Risk' }, { href: '/admin/audit-trail', label: 'Audit Trail' },
    { href: '/cpv/reports-analytics', label: 'Reports' }, { href: '/cpv/statistical-process-control', label: 'SPC' },
    { href: '/cpv/trend-analysis', label: 'Trends' },
  ], [productQuery, batchQuery]);

  const onFormProductChange = async (productId: string) => {
    setFormProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setForm((f) => ({ ...f, cpvProductId: productId, productName: p.productName, productCode: p.productCode }));
    const [batches, params] = await Promise.all([
      fetchEmBatchesForProduct(p.productName, p.id),
      fetchEnvironmentalParameters(form.monitoringType),
    ]);
    setFormBatches(batches);
    setFormParams(params);
  };

  const onMonitoringTypeChange = async (monitoringType: EnvironmentalMonitoringFormData['monitoringType']) => {
    setForm((f) => ({ ...f, monitoringType }));
    setFormParams(await fetchEnvironmentalParameters(monitoringType));
  };

  const onAreaChange = (areaId: string) => {
    const area = areas.find((a) => a.id === areaId);
    if (!area) return;
    setForm((f) => ({
      ...f,
      areaId,
      areaName: area.area_name,
      roomNumber: area.room_number,
      cleanroomGrade: area.cleanroom_grade as EnvironmentalMonitoringFormData['cleanroomGrade'],
      samplingLocation: area.process_area || area.area_name,
    }));
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
      resultType: (n.resultType as EnvironmentalMonitoringFormData['resultType']) || 'Numeric',
      autoDeviationRequired: Boolean(n.autoDeviationRequired),
      alertLimitLow: n.alertLimitLow ? Number(n.alertLimitLow) : undefined,
      alertLimitHigh: n.alertLimitHigh ? Number(n.alertLimitHigh) : undefined,
      actionLimitLow: n.actionLimitLow ? Number(n.actionLimitLow) : undefined,
      actionLimitHigh: n.actionLimitHigh ? Number(n.actionLimitHigh) : undefined,
    }));
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...defaultFormFields(),
      monitoringDate: defaultDate,
      monitoringTime: defaultTime,
      recordedBy: profile?.full_name || '',
      monitoringType: EM_MONITORING_TYPES[0],
      processStage: 'General Monitoring',
      resultType: 'Numeric',
      autoDeviationRequired: true,
    });
    const preselected = products.find((p) => p.productCode === productQuery || p.productName === productQuery);
    if (preselected) void onFormProductChange(preselected.id);
    setFormOpen(true);
  };

  const parseFormData = (): EnvironmentalSaveData | null => {
    const parsed = environmentalMonitoringFormSchema.safeParse(form);
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
      const { error: err } = await updateEnvironmentalRecord(editing.id, data, actor, editing, false);
      if (err) toast.error(err);
      else { toast.success('Record updated'); setFormOpen(false); await load(); }
    } else {
      const { error: err } = await createEnvironmentalRecord(data, actor);
      if (err) toast.error(err);
      else { toast.success('Record created'); setFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const applyQaOverride = async () => {
    const data = parseFormData();
    if (!data || !editing) return;
    setSubmitting(true);
    const { error: err } = await updateEnvironmentalRecord(editing.id, data, actor, editing, true, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    if (err) toast.error(err);
    else { toast.success('Record updated (QA override)'); setFormOpen(false); await load(); }
  };

  const confirmApprove = () => {
    if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
    setEsignAction('approve');
    setEsignOpen(true);
  };

  const applyApprove = async () => {
    if (!approveTarget) return;
    setSubmitting(true);
    const { error: err } = await approveEnvironmentalRecord(approveTarget.id, actor, actionReason, { esignConfirmed: true });
    setSubmitting(false); setEsignOpen(false); setApproveTarget(null); setActionReason('');
    if (err) toast.error(err);
    else { toast.success('Record approved'); await load(); }
  };

  const confirmDelete = () => {
    if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
    setEsignAction('delete');
    setEsignOpen(true);
  };

  const applyDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    const { error: err } = await softDeleteEnvironmentalRecord(deleteTarget.id, actor, actionReason, { esignConfirmed: true });
    setSubmitting(false); setEsignOpen(false); setDeleteTarget(null); setActionReason('');
    if (err) toast.error(err);
    else { toast.success('Record soft-deleted'); await load(); }
  };

  const openBulk = async () => {
    const preselected = products.find((p) => p.productCode === productQuery || p.productName === productQuery) || products[0];
    if (!preselected) return;
    setBulkProductId(preselected.id);
    setFormBatches(await fetchEmBatchesForProduct(preselected.productName, preselected.id));
    const params = await fetchEnvironmentalParameters(bulkMonitoringType);
    setBulkRows(params.slice(0, 8).map((param) => ({ param, observed: '', remarks: '' })));
    if (areas[0]) setBulkAreaId(areas[0].id);
    setBulkOpen(true);
  };

  const saveBulk = async () => {
    const p = products.find((x) => x.id === bulkProductId);
    const batch = formBatches.find((b) => b.id === bulkBatchId);
    const area = areas.find((a) => a.id === bulkAreaId);
    if (!p || !batch || !area) { toast.error('Select product, batch and area'); return; }
    if (bulkReason.trim().length < 5) { toast.error('Bulk change reason must be at least 5 characters'); return; }
    const rows: EnvironmentalMonitoringFormData[] = bulkRows.filter((r) => r.observed).map((row) => {
      const n = normalizeParameter(row.param);
      return {
        cpvProductId: bulkProductId,
        productName: p.productName,
        productCode: p.productCode,
        batchNumber: batch.batchNumber,
        areaName: area.area_name,
        areaId: area.id,
        roomNumber: area.room_number,
        cleanroomGrade: area.cleanroom_grade as EnvironmentalMonitoringFormData['cleanroomGrade'],
        processStage: 'General Monitoring',
        building: '',
        block: '',
        floor: '',
        site: '',
        department: '',
        shift: '',
        zone: '',
        ahuId: '',
        ahuName: '',
        isoClass: 'N/A',
        dataSource: 'Manual' as const,
        sensorId: '',
        alarmStatus: '',
        communicationStatus: 'OK',
        equipmentId: '',
        equipmentName: '',
        monitoringPointCode: '',
        monitoringPointName: '',
        monitoringType: bulkMonitoringType as EnvironmentalMonitoringFormData['monitoringType'],
        samplingLocation: area.process_area || area.area_name,
        parameterId: row.param.id || '',
        parameterCode: n.parameterCode,
        parameterName: n.parameterName,
        observedValue: Number(row.observed),
        targetValue: Number(n.target || n.targetValue) || undefined,
        lowerLimit: Number(n.lsl) || 0,
        upperLimit: Number(n.usl) || 0,
        unit: n.unit,
        resultType: (n.resultType as EnvironmentalMonitoringFormData['resultType']) || 'Numeric',
        monitoringDate: defaultDate,
        monitoringTime: defaultTime,
        recordedBy: profile?.full_name || '',
        reviewedBy: '',
        reviewDate: '',
        remarks: row.remarks,
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
    const { created, errors } = await bulkCreateEnvironmentalRecords(rows, actor, bulkReason);
    setSubmitting(false);
    if (errors.length) toast.error(errors[0]);
    toast.success(`${created} environmental records saved`);
    setBulkOpen(false);
    await load();
  };

  const columns: ColumnDef<EnvironmentalMonitoringRecord>[] = [
    { key: 'batchNumber', header: 'Batch' },
    { key: 'areaName', header: 'Area' },
    { key: 'cleanroomGrade', header: 'Grade', render: (r) => <GradeBadge grade={r.cleanroomGrade} /> },
    { key: 'parameterName', header: 'Parameter' },
    { key: 'observedValue', header: 'Value' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
  ];

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="Environmental Monitoring"
        description="Monitor cleanroom temperature, RH, differential pressure, particle and microbial data for CPV"
        trail={[{ label: 'Continued Process Verification', href: '/cpv/dashboard' }, { label: 'Environmental Monitoring' }]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
                downloadCsv(`environmental-monitoring-${new Date().toISOString().split('T')[0]}.csv`,
                  ['ID', 'Product', 'Batch', 'Building', 'Area', 'Grade', 'Type', 'Parameter', 'Observed', 'Unit', 'Status', 'Risk', 'Source', 'Sensor', 'Communication', 'Review'],
                  filtered.map((r) => [String(r.environmentalMonitoringId), String(r.productCode), String(r.batchNumber), String(r.building || ''), String(r.areaName), String(r.cleanroomGrade), String(r.monitoringType), String(r.parameterName), String(r.observedValue), String(r.unit), String(r.status), String(r.riskLevel), String(r.dataSource || 'Manual'), String(r.sensorId || ''), String(r.communicationStatus || ''), String(r.reviewStatus)]));
                await logEnvironmentalExport(actor, filtered.length);
                toast.success(`Exported ${filtered.length} environmental records`);
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
        {crossLinks.map((link) => <Link key={link.href + link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">{link.label}</Link>)}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        <KpiCard label="Total Records" value={summary.total} tone="blue" />
        <KpiCard label="Compliant" value={summary.compliant} tone="green" />
        <KpiCard label="Alert" value={summary.alert} tone="amber" />
        <KpiCard label="Action" value={summary.action} tone="amber" />
        <KpiCard label="Excursion" value={summary.excursion} tone="red" />
        <KpiCard label="OOS" value={Number((summary as unknown as Record<string, unknown>).oos || 0)} tone="red" />
        <KpiCard label="OOT" value={Number((summary as unknown as Record<string, unknown>).oot || 0)} tone="amber" />
        <KpiCard label="Grade A Excursions" value={summary.gradeAExcursions} tone="red" />
        <KpiCard label="Grade B Excursions" value={summary.gradeBExcursions} tone="red" />
        <KpiCard label="Microbial Excursions" value={summary.microbialExcursions} tone="red" />
        <KpiCard label="Deviation" value={summary.deviationTriggered} tone="amber" />
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
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Area Excursion Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.areaExcursionTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.areaExcursionTrend} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="area" type="category" width={90} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[1]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No area excursion data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Grade Risk Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.gradeRiskTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.gradeRiskTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="grade" /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[2]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No grade data" />}
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
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Temperature Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.temperatureTrend.length ? <ParameterTrendChart data={charts.temperatureTrend} /> : <EmptyState title="No temperature data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">RH Trend</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.rhTrend.length ? <ParameterTrendChart data={charts.rhTrend} /> : <EmptyState title="No RH data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Particle Count</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.particleTrend.length ? <ParameterTrendChart data={charts.particleTrend} /> : <EmptyState title="No particle data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Microbial Count</CardTitle></CardHeader>
          <CardContent className="h-[220px]">
            {charts.microbialTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.microbialTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="observed" fill={CHART_COLORS[3]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No microbial data" />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Parameter Trend</CardTitle>
          <Select value={trendParam} onValueChange={setTrendParam}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['Room Temperature', 'Relative Humidity', 'Differential Pressure', 'Particles >=0.5µm', 'Viable Count'].map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="h-[240px]">
          {trendData.length ? <ParameterTrendChart data={trendData} /> : <EmptyState title="No trend data" />}
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
            <Select value={gradeFilter} onValueChange={setGradeFilter}><SelectTrigger><SelectValue placeholder="Grade" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Grades</SelectItem>{CLEANROOM_GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Types</SelectItem>{EM_MONITORING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Status</SelectItem>{EM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={riskFilter} onValueChange={setRiskFilter}><SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Risk</SelectItem>{['Low', 'Medium', 'High', 'Critical'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={buildingFilter} onValueChange={setBuildingFilter}><SelectTrigger><SelectValue placeholder="Building" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Buildings</SelectItem>{buildingNames.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
            <Button variant="outline" size="sm" className="gap-1" onClick={clearFilters}><FilterX className="h-3.5 w-3.5" />Clear</Button>
          </div>
          {filtered.length === 0 ? <EmptyState title="No environmental records" /> : (
            <ResponsiveDataTable
              columns={columns}
              data={filtered}
              pageSize={10}
              onRowClick={(r) => router.push(`/cpv/environmental-monitoring/${r.id}`)}
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => router.push(`/cpv/environmental-monitoring/${row.id}`)}><Eye className="h-4 w-4" /></Button>
                  {canCreate && !isReadOnly && (!row.isLocked || canQaOverride) && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(row); setForm({ ...row, changeReason: '' }); setFormProductId(row.cpvProductId); void onFormProductChange(row.cpvProductId); setFormOpen(true);
                    }}><Pencil className="h-4 w-4" /></Button>
                  )}
                  {canReview && row.reviewStatus === 'Draft' && (
                    <Button size="icon" variant="ghost" onClick={async () => {
                      const { error: err } = await reviewEnvironmentalRecord(row.id, actor, 'Submitted for QA review');
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
          <SheetHeader><SheetTitle>{editing ? 'Edit Environmental Record' : 'New Environmental Record'}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-3">
            {editing?.isLocked && canQaOverride && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Record is locked. Saving will require QA override and electronic signature.
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
              <Select value={form.batchNumber || ''} onValueChange={(v) => setForm((f) => ({ ...f, batchNumber: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Area *</Label>
              <Select value={form.areaId || ''} onValueChange={onAreaChange}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.area_name} ({a.room_number})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Cleanroom Grade *</Label>
                <Select value={form.cleanroomGrade || ''} onValueChange={(v) => setForm((f) => ({ ...f, cleanroomGrade: v as EnvironmentalMonitoringFormData['cleanroomGrade'] }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{CLEANROOM_GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Process Stage</Label>
                <Select value={form.processStage || 'General Monitoring'} onValueChange={(v) => setForm((f) => ({ ...f, processStage: v as EnvironmentalMonitoringFormData['processStage'] }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{EM_PROCESS_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Monitoring Type *</Label>
              <Select value={form.monitoringType || EM_MONITORING_TYPES[0]} onValueChange={(v) => void onMonitoringTypeChange(v as EnvironmentalMonitoringFormData['monitoringType'])}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{EM_MONITORING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
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
              <div><Label>Lower Limit</Label><Input className="mt-1" type="number" value={form.lowerLimit ?? ''} onChange={(e) => setForm((f) => ({ ...f, lowerLimit: Number(e.target.value) }))} /></div>
              <div><Label>Upper Limit</Label><Input className="mt-1" type="number" value={form.upperLimit ?? ''} onChange={(e) => setForm((f) => ({ ...f, upperLimit: Number(e.target.value) }))} /></div>
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
          <DialogHeader><DialogTitle>Bulk Environmental Entry</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 py-2">
            <Select value={bulkProductId} onValueChange={async (v) => {
              setBulkProductId(v);
              const p = products.find((x) => x.id === v);
              if (p) setFormBatches(await fetchEmBatchesForProduct(p.productName, p.id));
            }}>
              <SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={bulkBatchId} onValueChange={setBulkBatchId}>
              <SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={bulkAreaId} onValueChange={setBulkAreaId}>
              <SelectTrigger><SelectValue placeholder="Area" /></SelectTrigger>
              <SelectContent>{areas.map((a) => <SelectItem key={a.id} value={a.id}>{a.area_name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={bulkMonitoringType} onValueChange={async (v) => {
              setBulkMonitoringType(v);
              const params = await fetchEnvironmentalParameters(v);
              setBulkRows(params.slice(0, 8).map((param) => ({ param, observed: '', remarks: '' })));
            }}>
              <SelectTrigger><SelectValue placeholder="Monitoring Type" /></SelectTrigger>
              <SelectContent>{EM_MONITORING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Change Reason *</Label><Textarea className="mt-1" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} /></div>
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
          <DialogHeader><DialogTitle>Approve Environmental Record</DialogTitle><DialogDescription>Change reason and electronic signature required (Part 11 / ALCOA+).</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button><Button disabled={submitting} onClick={confirmApprove}>Continue to E-Sign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Soft-Delete Environmental Record</DialogTitle><DialogDescription>Archive this record with change reason and electronic signature.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" disabled={submitting} onClick={confirmDelete}>Continue to E-Sign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Environmental Monitoring"
        recordId={esignAction === 'approve' ? approveTarget?.id || '' : esignAction === 'delete' ? deleteTarget?.id || '' : editing?.id || ''}
        documentNumber={esignAction === 'approve' ? approveTarget?.environmentalMonitoringId || '' : esignAction === 'delete' ? deleteTarget?.environmentalMonitoringId || '' : editing?.environmentalMonitoringId || ''}
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
