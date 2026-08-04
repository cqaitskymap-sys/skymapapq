'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Download, Eye, Pencil, CheckCircle, Layers, FilterX, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie } from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  summarizeCppResults, buildChartSeries, CPP_PROCESS_STAGES, CPP_RESULT_STATUSES,
  cppStageHasAreas, getCppAreasForStage, getCppHierarchyOptionsForStageArea,
  cppProcessStagesMatch,
  type CppResultFormData, type CppResultRecord, type CppHierarchyParameterOption,
} from '@/lib/cpv-cpp-monitoring';
import {
  fetchCppResults, fetchCppBatchesForProduct,
  fetchCppParametersForProduct, createCppResult, updateCppResult,
  approveCppResult, reviewCppResult, bulkCreateCppResults, autofillFromBatch,
  logCppExport, parameterTrendData, buildCppExportRows,
} from '@/lib/cpv-cpp-monitoring-service';
import { fetchActiveCpvProductsForBatch as fetchProducts } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import type { Parameter } from '@/lib/admin/schemas';
import { buildParameterId, normalizeParameter } from '@/lib/admin/parameter-service';
import {
  getOndansetronCppOptionsForStage,
  isOndansetronProduct,
  resolveOndansetronCppDefaults,
  type OndansetronCppOption,
} from '@/lib/ondansetron-bmr-spec';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { ParameterTrendChart } from './parameter-trend-chart';
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

type CppParamOption = Parameter | OndansetronCppOption | CppHierarchyParameterOption;

function isBmrCppOption(p: CppParamOption): p is OndansetronCppOption {
  return 'specificationText' in p && String(p.id).startsWith('bmr-cpp-');
}

function isHierarchyCppOption(p: CppParamOption): p is CppHierarchyParameterOption {
  return String(p.id).startsWith('cpp-hier-');
}

function paramOptionId(p: CppParamOption): string {
  if (isBmrCppOption(p) || isHierarchyCppOption(p)) return p.id;
  return p.id || p.parameterId || buildParameterId(p.parameterCode);
}

function paramOptionName(p: CppParamOption): string {
  return p.parameterName || '';
}

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

export function CppMonitoringPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreate = cpvPermissions.canEnterCpp(role) && !cpvPermissions.isCppViewOnly(role);
  const canReview = cpvPermissions.canReviewCpp(role);
  const canImportExport = cpvPermissions.canImportExportCpp(role);
  const canQaOverride = cpvPermissions.canReviewCpp(role);
  const isReadOnly = cpvPermissions.isReadOnly(role) || cpvPermissions.isCppViewOnly(role);

  const [results, setResults] = useState<CppResultRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<CppResultRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<CppResultRecord | null>(null);
  const [approveReason, setApproveReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [overrideEsign, setOverrideEsign] = useState(false);

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [productFilter, setProductFilter] = useState('all');
  const [batchFilter, setBatchFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [trendParam, setTrendParam] = useState('all');

  const [formProductId, setFormProductId] = useState('');
  const [formProductName, setFormProductName] = useState('');
  const [formBatches, setFormBatches] = useState<Awaited<ReturnType<typeof fetchCppBatchesForProduct>>>([]);
  const [formParams, setFormParams] = useState<CppParamOption[]>([]);
  const [form, setForm] = useState<Partial<CppResultFormData>>({ changeReason: '' });

  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkBatchId, setBulkBatchId] = useState('');
  const [bulkStage, setBulkStage] = useState<string>(CPP_PROCESS_STAGES[0]);
  const [bulkArea, setBulkArea] = useState('');
  const [bulkReason, setBulkReason] = useState('Bulk CPP entry');
  const [bulkRows, setBulkRows] = useState<Array<{ param: CppParamOption; observed: string; remarks: string }>>([]);

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' };

  useEffect(() => {
    if (productQuery) setSearch(productQuery);
    else if (batchQuery) setSearch(batchQuery);
  }, [productQuery, batchQuery]);

  useEffect(() => {
    if (batchQuery) setBatchFilter(batchQuery);
  }, [batchQuery]);


  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, prods] = await Promise.all([fetchCppResults(), fetchProducts()]);
      setResults(rows);
      setProducts(prods);
    } catch {
      setError('Failed to load CPP results.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return results.filter((r) => {
      if (productFilter !== 'all' && r.productName !== productFilter && r.productCode !== productFilter) return false;
      if (batchFilter !== 'all' && r.batchNumber !== batchFilter) return false;
      if (stageFilter !== 'all' && !cppProcessStagesMatch(r.processStage, stageFilter)) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (!q) return true;
      return (
        r.productName.toLowerCase().includes(q)
        || r.productCode.toLowerCase().includes(q)
        || r.batchNumber.toLowerCase().includes(q)
        || r.parameterName.toLowerCase().includes(q)
        || r.parameterCode.toLowerCase().includes(q)
        || (r.equipmentName || '').toLowerCase().includes(q)
        || (r.site || '').toLowerCase().includes(q)
      );
    });
  }, [results, search, productFilter, batchFilter, stageFilter, statusFilter, riskFilter]);

  const clearFilters = () => {
    setSearch('');
    setProductFilter('all');
    setBatchFilter('all');
    setStageFilter('all');
    setStatusFilter('all');
    setRiskFilter('all');
  };

  const summary = useMemo(() => summarizeCppResults(results), [results]);
  const charts = useMemo(() => buildChartSeries(filtered), [filtered]);
  const productNames = useMemo(() => Array.from(new Set(results.map((r) => r.productName))), [results]);
  const batchNumbers = useMemo(() => Array.from(new Set(results.map((r) => r.batchNumber))), [results]);
  const paramNames = useMemo(() => Array.from(new Set(results.map((r) => r.parameterName))), [results]);
  const trendData = useMemo(() => trendParam !== 'all' ? parameterTrendData(filtered, trendParam) : [], [filtered, trendParam]);

  const resolveFormParameters = useCallback(async (
    productName: string,
    productId: string,
    processStage: string,
    processArea = '',
  ): Promise<CppParamOption[]> => {
    const resolveDefaults = isOndansetronProduct(productName)
      ? (bmrName: string) => resolveOndansetronCppDefaults(bmrName)
      : undefined;
    const hierarchyOptions = getCppHierarchyOptionsForStageArea(processStage, processArea, resolveDefaults);

    const dbParams = await fetchCppParametersForProduct(productName, productId, processStage, processArea);
    const hierarchyNames = new Set(hierarchyOptions.map((o) => o.parameterName.toLowerCase()));

    if (isOndansetronProduct(productName)) {
      const bmrOptions = getOndansetronCppOptionsForStage(processStage);
      const filteredBmr = bmrOptions.filter((o) => !hierarchyNames.has(o.parameterName.toLowerCase()));
      if (!dbParams.length) return [...hierarchyOptions, ...filteredBmr];
      const dbNames = new Set(dbParams.map((p) => normalizeParameter(p).parameterName.toLowerCase()));
      const extras = filteredBmr.filter((o) => !dbNames.has(o.parameterName.toLowerCase()));
      const dbExtras = dbParams.filter((p) => !hierarchyNames.has(normalizeParameter(p).parameterName.toLowerCase()));
      return [...hierarchyOptions, ...dbParams.filter((p) => hierarchyNames.has(normalizeParameter(p).parameterName.toLowerCase())), ...dbExtras, ...extras];
    }

    if (!dbParams.length) return hierarchyOptions;
    const extras = dbParams.filter((p) => !hierarchyNames.has(normalizeParameter(p).parameterName.toLowerCase()));
    return [...hierarchyOptions, ...extras];
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormProductId('');
    setFormProductName('');
    setFormBatches([]);
    setFormParams([]);
    setForm({
      observationDateTime: new Date().toISOString(),
      recordedBy: profile?.full_name || '',
      processStage: CPP_PROCESS_STAGES[0],
      processArea: '',
      resultType: 'Numeric',
      criticality: 'Major',
      frequency: 'Per Batch',
      changeReason: '',
      equipmentId: '',
      equipmentName: '',
      site: '',
      department: '',
      shift: '',
      productVersion: '',
    });
    setFormOpen(true);
  };

  const onFormProductChange = async (productId: string) => {
    setFormProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setFormProductName(p.productName);
    setForm((f) => ({
      ...f,
      cpvProductId: productId,
      productName: p.productName,
      productCode: p.productCode,
      genericName: p.genericName,
      strength: p.strength,
      dosageForm: p.dosageForm,
    }));
    const stage = form.processStage || CPP_PROCESS_STAGES[0];
    const area = form.processArea || '';
    const [batches, params] = await Promise.all([
      fetchCppBatchesForProduct(p.productName),
      resolveFormParameters(p.productName, productId, stage, area),
    ]);
    setFormBatches(batches);
    setFormParams(params);
  };

  const onFormBatchChange = async (batchNumber: string) => {
    const batch = formBatches.find((b) => b.batchNumber === batchNumber);
    setForm((f) => ({
      ...f,
      batchNumber,
      manufacturingDate: batch?.manufacturingDate || f.manufacturingDate,
    }));
  };

  const onFormStageChange = async (stage: string) => {
    const areas = getCppAreasForStage(stage);
    setForm((f) => ({
      ...f,
      processStage: stage,
      processArea: areas[0] ?? '',
      parameterId: '',
      parameterCode: '',
      parameterName: '',
      parameterCategory: '',
      unit: '',
      lowerLimit: undefined,
      upperLimit: undefined,
      targetValue: undefined,
    }));
    if (formProductId) {
      const p = products.find((x) => x.id === formProductId);
      if (p) {
        const area = areas[0] ?? '';
        const params = await resolveFormParameters(p.productName, formProductId, stage, area);
        setFormParams(params);
      }
    } else {
      setFormParams(getCppHierarchyOptionsForStageArea(stage, areas[0] ?? ''));
    }
  };

  const onFormAreaChange = async (area: string) => {
    setForm((f) => ({
      ...f,
      processArea: area,
      parameterId: '',
      parameterCode: '',
      parameterName: '',
      parameterCategory: '',
      unit: '',
      lowerLimit: undefined,
      upperLimit: undefined,
      targetValue: undefined,
    }));
    const stage = form.processStage || CPP_PROCESS_STAGES[0];
    if (formProductId) {
      const p = products.find((x) => x.id === formProductId);
      if (p) {
        const params = await resolveFormParameters(p.productName, formProductId, stage, area);
        setFormParams(params);
      }
    } else {
      setFormParams(getCppHierarchyOptionsForStageArea(stage, area));
    }
  };

  const onFormParamChange = (paramId: string) => {
    const p = formParams.find((x) => paramOptionId(x) === paramId);
    if (!p) return;

    if (isBmrCppOption(p)) {
      setForm((f) => ({
        ...f,
        parameterId: paramId,
        parameterCode: p.parameterCode,
        parameterName: p.parameterName,
        parameterCategory: p.section,
        lowerLimit: p.lsl,
        upperLimit: p.usl,
        targetValue: p.target,
        unit: p.unit,
        resultType: p.resultType === 'Text' ? 'Text' : 'Numeric',
        criticality: p.criticality,
        processStage: f.processStage || p.processStage || CPP_PROCESS_STAGES[0],
      }));
      return;
    }

    if (isHierarchyCppOption(p)) {
      setForm((f) => ({
        ...f,
        parameterId: paramId,
        parameterCode: p.parameterCode,
        parameterName: p.parameterName,
        parameterCategory: p.processArea || p.processStage,
        processArea: p.processArea || f.processArea || '',
        lowerLimit: p.lsl,
        upperLimit: p.usl,
        targetValue: p.target,
        unit: p.unit,
        resultType: p.resultType === 'Text' ? 'Text' : 'Numeric',
        criticality: p.criticality,
        processStage: f.processStage || p.processStage || CPP_PROCESS_STAGES[0],
      }));
      return;
    }

    const n = normalizeParameter(p);
    const ond = isOndansetronProduct(formProductName)
      ? resolveOndansetronCppDefaults(n.parameterName) : null;
    setForm((f) => ({
      ...f,
      parameterId: paramId,
      parameterCode: n.parameterCode,
      parameterName: n.parameterName,
      parameterCategory: n.parameterCategory,
      lowerLimit: ond?.lsl ?? (Number(n.lsl || n.lowerLimit) || 0),
      upperLimit: ond?.usl ?? (Number(n.usl || n.upperLimit) || 0),
      targetValue: ond?.target ?? (Number(n.target || n.targetValue) || 0),
      unit: ond?.unit || n.unit,
      resultType: (n.resultType as CppResultFormData['resultType']) || 'Numeric',
      criticality: (ond?.criticality || n.criticality as CppResultFormData['criticality']) || 'Major',
      alertLimitLow: n.alertLimitLow ? Number(n.alertLimitLow) : undefined,
      alertLimitHigh: n.alertLimitHigh ? Number(n.alertLimitHigh) : undefined,
      actionLimitLow: n.actionLimitLow ? Number(n.actionLimitLow) : undefined,
      actionLimitHigh: n.actionLimitHigh ? Number(n.actionLimitHigh) : undefined,
      frequency: n.frequency,
      processStage: f.processStage || ond?.processStage || n.processStage || CPP_PROCESS_STAGES[0],
    }));
  };

  const saveForm = async () => {
    if (!form.cpvProductId || !form.batchNumber || !form.parameterCode || form.observedValue === undefined || form.observedValue === '') {
      toast.error('Complete required fields');
      return;
    }
    if (!form.changeReason || form.changeReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    const qaOverride = Boolean(editing?.isLocked && editing.reviewStatus === 'Approved' && canQaOverride);
    if (qaOverride) {
      setOverrideEsign(true);
      setEsignOpen(true);
      return;
    }
    setSubmitting(true);
    const data = form as CppResultFormData;
    if (editing) {
      const { error: err } = await updateCppResult(editing.id, data, actor, editing, false);
      if (err) toast.error(err);
      else { toast.success('CPP result updated'); setFormOpen(false); await load(); }
    } else {
      const { error: err } = await createCppResult(data, actor);
      if (err) toast.error(err);
      else { toast.success('CPP result created'); setFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const applyQaOverride = async () => {
    if (!editing) return;
    setSubmitting(true);
    const { error: err } = await updateCppResult(
      editing.id,
      form as CppResultFormData,
      actor,
      editing,
      true,
      { esignConfirmed: true },
    );
    setSubmitting(false);
    setEsignOpen(false);
    setOverrideEsign(false);
    if (err) toast.error(err);
    else {
      toast.success('CPP result updated (QA override)');
      setFormOpen(false);
      await load();
    }
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    if (approveReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setEsignOpen(true);
  };

  const applyApprove = async () => {
    if (!approveTarget) return;
    setSubmitting(true);
    const { error: err } = await approveCppResult(
      approveTarget.id,
      actor,
      approveTarget,
      approveReason,
      { esignConfirmed: true },
    );
    setSubmitting(false);
    setEsignOpen(false);
    setApproveTarget(null);
    setApproveReason('');
    if (err) toast.error(err);
    else {
      toast.success('CPP result approved');
      await load();
    }
  };

  const openBulk = async (productId: string) => {
    setBulkProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const areas = getCppAreasForStage(bulkStage);
    const area = areas[0] ?? '';
    setBulkArea(area);
    const params = await resolveFormParameters(p.productName, productId, bulkStage, area);
    setBulkRows(params.map((param) => ({ param, observed: '', remarks: '' })));
    setBulkOpen(true);
  };

  const saveBulk = async () => {
    const p = products.find((x) => x.id === bulkProductId);
    if (!p || !bulkBatchId) { toast.error('Select product and batch'); return; }
    const batch = formBatches.find((b) => b.id === bulkBatchId) || (await fetchCppBatchesForProduct(p.productName)).find((b) => b.id === bulkBatchId);
    if (!batch) { toast.error('Invalid batch'); return; }
    const rows: CppResultFormData[] = bulkRows.filter((r) => r.observed).map((row) => {
      if (isBmrCppOption(row.param)) {
        const n = row.param;
        return {
          cpvProductId: bulkProductId,
          productName: p.productName,
          productCode: p.productCode,
          batchNumber: batch.batchNumber,
          manufacturingDate: batch.manufacturingDate,
          processStage: bulkStage,
          processArea: bulkArea,
          parameterId: n.id,
          parameterCode: n.parameterCode,
          parameterName: n.parameterName,
          parameterCategory: n.section,
          observedValue: Number(row.observed),
          targetValue: n.target,
          lowerLimit: n.lsl,
          upperLimit: n.usl,
          unit: n.unit,
          resultType: (n.resultType === 'Text' ? 'Text' : 'Numeric') as CppResultFormData['resultType'],
          frequency: 'Per Batch',
          criticality: n.criticality,
          observationDateTime: new Date().toISOString(),
          recordedBy: profile?.full_name || '',
          reviewedBy: '',
          reviewDate: '',
          remarks: row.remarks,
          changeReason: bulkReason,
          equipmentId: '',
          equipmentName: '',
          machineId: '',
          sensorId: '',
          site: '',
          department: '',
          shift: '',
          productVersion: '',
        };
      }
      if (isHierarchyCppOption(row.param)) {
        const n = row.param;
        return {
          cpvProductId: bulkProductId,
          productName: p.productName,
          productCode: p.productCode,
          batchNumber: batch.batchNumber,
          manufacturingDate: batch.manufacturingDate,
          processStage: bulkStage,
          processArea: n.processArea || bulkArea,
          parameterId: n.id,
          parameterCode: n.parameterCode,
          parameterName: n.parameterName,
          parameterCategory: n.processArea || n.processStage,
          observedValue: Number(row.observed),
          targetValue: n.target,
          lowerLimit: n.lsl,
          upperLimit: n.usl,
          unit: n.unit,
          resultType: (n.resultType === 'Text' ? 'Text' : 'Numeric') as CppResultFormData['resultType'],
          frequency: 'Per Batch',
          criticality: n.criticality,
          observationDateTime: new Date().toISOString(),
          recordedBy: profile?.full_name || '',
          reviewedBy: '',
          reviewDate: '',
          remarks: row.remarks,
          changeReason: bulkReason,
          equipmentId: '',
          equipmentName: '',
          machineId: '',
          sensorId: '',
          site: '',
          department: '',
          shift: '',
          productVersion: '',
        };
      }
      const n = normalizeParameter(row.param);
      const ond = isOndansetronProduct(p.productName)
        ? resolveOndansetronCppDefaults(n.parameterName) : null;
      return {
        cpvProductId: bulkProductId,
        productName: p.productName,
        productCode: p.productCode,
        batchNumber: batch.batchNumber,
        manufacturingDate: batch.manufacturingDate,
        processStage: bulkStage,
        processArea: bulkArea,
        parameterId: row.param.id || '',
        parameterCode: n.parameterCode,
        parameterName: n.parameterName,
        parameterCategory: n.parameterCategory,
        observedValue: Number(row.observed),
        targetValue: ond?.target ?? (Number(n.target || n.targetValue) || 0),
        lowerLimit: ond?.lsl ?? (Number(n.lsl) || 0),
        upperLimit: ond?.usl ?? (Number(n.usl) || 0),
        unit: ond?.unit || n.unit,
        resultType: (n.resultType as CppResultFormData['resultType']) || 'Numeric',
        frequency: n.frequency,
        criticality: (ond?.criticality || n.criticality as CppResultFormData['criticality']) || 'Major',
        observationDateTime: new Date().toISOString(),
        recordedBy: profile?.full_name || '',
        reviewedBy: '',
        reviewDate: '',
        remarks: row.remarks,
        changeReason: bulkReason,
        equipmentId: '',
        equipmentName: '',
        machineId: '',
        sensorId: '',
        site: '',
        department: '',
        shift: '',
        productVersion: '',
      };
    });
    if (bulkReason.trim().length < 5) {
      toast.error('Bulk change reason must be at least 5 characters');
      return;
    }
    setSubmitting(true);
    const { created, errors } = await bulkCreateCppResults(rows, actor, bulkReason);
    setSubmitting(false);
    if (errors.length) toast.error(errors[0]);
    toast.success(`${created} CPP results saved`);
    setBulkOpen(false);
    await load();
  };

  const columns: ColumnDef<CppResultRecord>[] = [
    { key: 'batchNumber', header: 'Batch' },
    { key: 'parameterName', header: 'Parameter' },
    { key: 'processStage', header: 'Stage' },
    { key: 'processArea', header: 'Area' },
    { key: 'observedValue', header: 'Observed' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'reviewStatus', header: 'Review' },
  ];

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title="CPP Monitoring"
        description="Monitor Critical Process Parameters batch-wise for Continued Process Verification"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'CPP Monitoring' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2 no-print" onClick={async () => {
                const { headers, rows } = buildCppExportRows(filtered);
                downloadCsv(`cpp-results-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
                await logCppExport(actor, filtered.length);
                toast.success(`Exported ${filtered.length} CPP results`);
              }}>
                <Download className="h-4 w-4" />Export
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => printPage()}>
              <Printer className="h-4 w-4" />Print
            </Button>
            {canCreate && !isReadOnly && (
              <>
                <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => products[0] && openBulk(products[0].id)}>
                  <Layers className="h-4 w-4" />Bulk Entry
                </Button>
                <Button size="sm" className="gap-2 no-print" onClick={openCreate}><Plus className="h-4 w-4" />New CPP Result</Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        <KpiCard label="Total Results" value={summary.total} tone="blue" />
        <KpiCard label="Compliant" value={summary.compliant} tone="green" />
        <KpiCard label="Alert" value={summary.alert} tone="amber" />
        <KpiCard label="Action" value={summary.action} tone="amber" />
        <KpiCard label="OOT/OOL" value={summary.ootOol} tone="red" />
        <KpiCard label="High Risk" value={summary.highRisk} tone="red" />
        <KpiCard label="Critical Risk" value={summary.criticalRisk} tone="red" />
        <KpiCard label="Deviation Triggered" value={summary.deviationTriggered} tone="amber" />
        <KpiCard label="CAPA Suggested" value={summary.capaSuggested} tone="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">CPP Compliance Trend</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            {charts.complianceTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.complianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis domain={[0, 100]} /><Tooltip />
                  <Line type="monotone" dataKey="rate" name="Compliance %" stroke={CHART_COLORS[0]} strokeWidth={2} /></LineChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No trend data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Risk Distribution</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            {charts.riskDistribution.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={charts.riskDistribution} dataKey="count" nameKey="level" cx="50%" cy="50%" outerRadius={80} label>
                  {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Pie><Tooltip /></PieChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No risk data" />}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Stage Non-Compliance</CardTitle></CardHeader>
          <CardContent className="h-[260px]">
            {charts.stageNonCompliance.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.stageNonCompliance}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="stage" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="count" fill={CHART_COLORS[2]} /></BarChart>
              </ResponsiveContainer>
            ) : <EmptyState title="No data" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Parameter Trend</CardTitle>
            <Select value={trendParam} onValueChange={setTrendParam}>
              <SelectTrigger className="h-8 w-[160px]"><SelectValue placeholder="Parameter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Select parameter</SelectItem>
                {paramNames.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent><ParameterTrendChart data={trendData} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid gap-3 lg:grid-cols-6">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="lg:col-span-2" />
            <Select value={productFilter} onValueChange={setProductFilter}><SelectTrigger><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Products</SelectItem>{productNames.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
            <Select value={batchFilter} onValueChange={setBatchFilter}><SelectTrigger><SelectValue placeholder="Batch" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Batches</SelectItem>{batchNumbers.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Status</SelectItem>{CPP_RESULT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Select value={stageFilter} onValueChange={setStageFilter}><SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Stages</SelectItem>{CPP_PROCESS_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
            <Button variant="outline" size="sm" className="gap-1" onClick={clearFilters}><FilterX className="h-3.5 w-3.5" />Clear</Button>
          </div>
          {filtered.length === 0 ? <EmptyState title="No CPP results" /> : (
            <ResponsiveDataTable
              columns={columns}
              data={filtered}
              pageSize={10}
              onRowClick={(r) => router.push(`/cpv/cpp/${r.id}`)}
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => router.push(`/cpv/cpp/${row.id}`)}><Eye className="h-4 w-4" /></Button>
                  {canCreate && !isReadOnly && (!row.isLocked || canQaOverride) && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(row);
                      setForm(row);
                      setFormProductId(row.cpvProductId);
                      setFormProductName(row.productName);
                      void onFormProductChange(row.cpvProductId);
                      setFormOpen(true);
                    }}><Pencil className="h-4 w-4" /></Button>
                  )}
                  {canReview && row.reviewStatus === 'Draft' && (
                    <Button size="icon" variant="ghost" onClick={async () => {
                      const { error: err } = await reviewCppResult(row.id, actor, row);
                      if (err) toast.error(err);
                      else { toast.success('Submitted for review'); await load(); }
                    }}><CheckCircle className="h-4 w-4" /></Button>
                  )}
                  {canReview && (row.reviewStatus === 'Under Review' || row.reviewStatus === 'Draft') && (
                    <Button size="sm" variant="outline" onClick={() => {
                      setApproveTarget(row);
                      setApproveReason('');
                      setOverrideEsign(false);
                    }}>Approve</Button>
                  )}
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader><SheetTitle>{editing ? 'Edit CPP Result' : 'New CPP Result'}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-3">
            {!editing && (
              <div><Label>CPV Product *</Label>
                <Select value={formProductId} onValueChange={(v) => void onFormProductChange(v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Batch *</Label>
              <Select value={form.batchNumber || ''} onValueChange={(v) => void onFormBatchChange(v)} disabled={Boolean(editing?.isLocked)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Batch" /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Process Stage *</Label>
              <Select value={form.processStage || ''} onValueChange={(v) => void onFormStageChange(v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{CPP_PROCESS_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {cppStageHasAreas(form.processStage || '') && (
              <div><Label>Area *</Label>
                <Select value={form.processArea || ''} onValueChange={(v) => void onFormAreaChange(v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    {getCppAreasForStage(form.processStage || '').map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Parameter *</Label>
              <Select
                value={form.parameterId || ''}
                onValueChange={onFormParamChange}
                disabled={Boolean(editing) || !formProductId || (cppStageHasAreas(form.processStage || '') && !form.processArea)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={
                    !formProductId
                      ? 'Select product first'
                      : cppStageHasAreas(form.processStage || '') && !form.processArea
                        ? 'Select area first'
                        : 'Parameter'
                  } />
                </SelectTrigger>
                <SelectContent>
                  {formParams.map((p) => (
                    <SelectItem key={paramOptionId(p)} value={paramOptionId(p)}>{paramOptionName(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Observed Value *</Label><Input className="mt-1" value={String(form.observedValue ?? '')} onChange={(e) => setForm((f) => ({ ...f, observedValue: e.target.value }))} /></div>
              <div>
                <Label>Unit</Label>
                <Input className="mt-1 bg-muted" value={form.unit || ''} readOnly placeholder="Auto-filled from parameter" />
              </div>
              <div>
                <Label>LSL (Lower Specification Limit)</Label>
                <Input className="mt-1 bg-muted" type="number" value={form.lowerLimit ?? ''} readOnly placeholder="Auto-filled from parameter" />
              </div>
              <div>
                <Label>USL (Upper Specification Limit)</Label>
                <Input className="mt-1 bg-muted" type="number" value={form.upperLimit ?? ''} readOnly placeholder="Auto-filled from parameter" />
              </div>
            </div>
            <div><Label>Observation Date Time *</Label><Input className="mt-1" type="datetime-local" value={form.observationDateTime?.slice(0, 16) || ''} onChange={(e) => setForm((f) => ({ ...f, observationDateTime: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Equipment</Label><Input className="mt-1" value={form.equipmentName || ''} onChange={(e) => setForm((f) => ({ ...f, equipmentName: e.target.value }))} /></div>
              <div><Label>Site</Label><Input className="mt-1" value={form.site || ''} onChange={(e) => setForm((f) => ({ ...f, site: e.target.value }))} /></div>
              <div><Label>Department</Label><Input className="mt-1" value={form.department || ''} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} /></div>
              <div><Label>Shift</Label><Input className="mt-1" value={form.shift || ''} onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))} /></div>
            </div>
            <div><Label>Remarks</Label><Textarea className="mt-1" value={form.remarks || ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
            <div>
              <Label>Change Reason * (ALCOA+ / Part 11)</Label>
              <Textarea
                className="mt-1"
                placeholder="Describe why this create/update is being performed"
                value={form.changeReason || ''}
                onChange={(e) => setForm((f) => ({ ...f, changeReason: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={() => void saveForm()} disabled={submitting}>{submitting ? 'Saving...' : 'Save'}</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bulk CPP Entry</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3 py-2">
            <div><Label>Product</Label>
              <Select value={bulkProductId} onValueChange={async (v) => {
                setBulkProductId(v);
                const p = products.find((x) => x.id === v);
                if (p) {
                  const batches = await fetchCppBatchesForProduct(p.productName);
                  setFormBatches(batches);
                  const params = await resolveFormParameters(p.productName, v, bulkStage, bulkArea);
                  setBulkRows(params.map((param) => ({ param, observed: '', remarks: '' })));
                }
              }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Batch</Label>
              <Select value={bulkBatchId} onValueChange={setBulkBatchId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{formBatches.map((b) => <SelectItem key={b.id} value={b.id}>{b.batchNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Process Stage</Label>
              <Select value={bulkStage} onValueChange={async (v) => {
                setBulkStage(v);
                const areas = getCppAreasForStage(v);
                const area = areas[0] ?? '';
                setBulkArea(area);
                const p = products.find((x) => x.id === bulkProductId);
                if (p) {
                  const params = await resolveFormParameters(p.productName, bulkProductId, v, area);
                  setBulkRows(params.map((param) => ({ param, observed: '', remarks: '' })));
                }
              }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{CPP_PROCESS_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {cppStageHasAreas(bulkStage) && (
              <div><Label>Area</Label>
                <Select value={bulkArea} onValueChange={async (v) => {
                  setBulkArea(v);
                  const p = products.find((x) => x.id === bulkProductId);
                  if (p) {
                    const params = await resolveFormParameters(p.productName, bulkProductId, bulkStage, v);
                    setBulkRows(params.map((param) => ({ param, observed: '', remarks: '' })));
                  }
                }}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    {getCppAreasForStage(bulkStage).map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Parameter</TableHead><TableHead>Target</TableHead><TableHead>LCL/UCL</TableHead><TableHead>Observed</TableHead><TableHead>Remarks</TableHead></TableRow></TableHeader>
            <TableBody>
              {bulkRows.map((row, i) => {
                if (isBmrCppOption(row.param) || isHierarchyCppOption(row.param)) {
                  const n = row.param;
                  return (
                    <TableRow key={paramOptionId(row.param) || i}>
                      <TableCell>{paramOptionName(row.param)}</TableCell>
                      <TableCell>{n.target}</TableCell>
                      <TableCell>{`${n.lsl}/${n.usl}`}</TableCell>
                      <TableCell><Input value={row.observed} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, observed: e.target.value } : r))} /></TableCell>
                      <TableCell><Input value={row.remarks} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, remarks: e.target.value } : r))} /></TableCell>
                    </TableRow>
                  );
                }
                const n = normalizeParameter(row.param);
                return (
                  <TableRow key={paramOptionId(row.param) || i}>
                    <TableCell>{paramOptionName(row.param)}</TableCell>
                    <TableCell>{n.target || n.targetValue}</TableCell>
                    <TableCell>{n.lsl}/{n.usl}</TableCell>
                    <TableCell><Input value={row.observed} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, observed: e.target.value } : r))} /></TableCell>
                    <TableCell><Input value={row.remarks} onChange={(e) => setBulkRows((rows) => rows.map((r, j) => j === i ? { ...r, remarks: e.target.value } : r))} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <DialogFooter>
            <div className="mr-auto w-full max-w-sm">
              <Label className="text-xs">Change Reason *</Label>
              <Input className="mt-1" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="Bulk entry reason" />
            </div>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={() => void saveBulk()} disabled={submitting}>Save All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(approveTarget) && !esignOpen} onOpenChange={(o) => { if (!o) setApproveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve CPP Result</DialogTitle>
            <DialogDescription>
              Electronic signature is required. Change reason is mandatory (ALCOA+ / Part 11).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={approveReason} onChange={(e) => setApproveReason(e.target.value)} placeholder="Why is this result being approved?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => void confirmApprove()}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={(v) => {
          setEsignOpen(v);
          if (!v) {
            setSubmitting(false);
            setOverrideEsign(false);
          }
        }}
        moduleName="CPP Monitoring"
        recordId={overrideEsign ? (editing?.id || 'cpp') : (approveTarget?.id || 'cpp')}
        documentNumber={overrideEsign ? editing?.cppResultId : approveTarget?.cppResultId}
        actionType={overrideEsign ? 'QA Override' : 'Approve'}
        onSuccess={() => {
          if (overrideEsign) void applyQaOverride();
          else void applyApprove();
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
