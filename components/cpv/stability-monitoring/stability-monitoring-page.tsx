'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Download, Eye, Pencil, Layers, Calendar, CheckCircle, FilterX, Printer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  summarizeStability, buildStabilityChartSeries, stabilityStudyFormSchema, stabilityResultFormSchema,
  STABILITY_STUDY_TYPES, STABILITY_STORAGE_CONDITIONS, STABILITY_PULLING_INTERVALS,
  STABILITY_RESULT_STATUSES,
  DEFAULT_STABILITY_PARAMETERS,
  type StabilityStudyFormData, type StabilityResultFormData,
  type StabilityStudyRecord, type StabilityResultRecord, type StabilityScheduleRecord,
} from '@/lib/cpv-stability-monitoring';
import {
  fetchStabilityStudies, fetchStabilitySchedules, fetchStabilityResults,
  fetchStabilityBatchesForProduct, createStabilityStudy, updateStabilityStudy,
  generateStabilitySchedule, updateSchedulePull, refreshScheduleStatuses,
  createStabilityResult, updateStabilityResult, approveStabilityResult, reviewStabilityResult, softDeleteStabilityResult,
  bulkCreateStabilityResults, logStabilityExport, stabilityParameterTrendData,
  buildStabilityComputedFields, defaultStabilityParameters,
} from '@/lib/cpv-stability-monitoring-service';
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';
import type { ColumnDef } from '@/components/admin/admin-data-table';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function IntervalBadge({ interval }: { interval: string }) {
  return <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{interval}</span>;
}

function StorageConditionBadge({ condition }: { condition: string }) {
  return (
    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 max-w-[140px] truncate inline-block" title={condition}>
      {condition}
    </span>
  );
}

function ScheduleBadge({ status }: { status: string }) {
  const cls = status === 'Missed' ? 'bg-red-50 text-red-700 border-red-200'
    : status === 'Due Soon' ? 'bg-amber-50 text-amber-700 border-amber-200'
      : status === 'Testing Completed' ? 'bg-green-50 text-green-700 border-green-200'
        : status === 'Pulled' ? 'bg-blue-50 text-blue-700 border-blue-200'
          : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

export function StabilityMonitoringPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const batchQuery = searchParams.get('batch') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canCreateStudy = cpvPermissions.canCreateStability(role);
  const canEnterResults = cpvPermissions.canEnterStabilityResults(role);
  const canUpdatePull = cpvPermissions.canUpdateStabilityPull(role);
  const canReview = cpvPermissions.canReviewStability(role);
  const canImportExport = cpvPermissions.canImportExportStability(role);
  const isReadOnly = cpvPermissions.isStabilityViewOnly(role) || cpvPermissions.isReadOnly(role);

  const [studies, setStudies] = useState<StabilityStudyRecord[]>([]);
  const [schedules, setSchedules] = useState<StabilityScheduleRecord[]>([]);
  const [results, setResults] = useState<StabilityResultRecord[]>([]);
  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<'results' | 'studies' | 'schedules'>('results');

  const [studyFormOpen, setStudyFormOpen] = useState(false);
  const [resultFormOpen, setResultFormOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingStudy, setEditingStudy] = useState<StabilityStudyRecord | null>(null);
  const [editingResult, setEditingResult] = useState<StabilityResultRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [approveTarget, setApproveTarget] = useState<StabilityResultRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StabilityResultRecord | null>(null);
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<'approve' | 'delete' | 'qa-override'>('approve');
  const [actionReason, setActionReason] = useState('');

  const [search, setSearch] = useState(productQuery || batchQuery);
  const [studyTypeFilter, setStudyTypeFilter] = useState('all');
  const [conditionFilter, setConditionFilter] = useState('all');
  const [intervalFilter, setIntervalFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [trendParam, setTrendParam] = useState('Assay');

  const [studyForm, setStudyForm] = useState<Partial<StabilityStudyFormData>>({});
  const [studyProductId, setStudyProductId] = useState('');
  const [studyBatches, setStudyBatches] = useState<Awaited<ReturnType<typeof fetchStabilityBatchesForProduct>>>([]);

  const [resultForm, setResultForm] = useState<Partial<StabilityResultFormData>>({});
  const [selectedStudyId, setSelectedStudyId] = useState('');
  const [computedStatus, setComputedStatus] = useState('');

  const [bulkProductId, setBulkProductId] = useState('');
  const [bulkStudyId, setBulkStudyId] = useState('');
  const [bulkInterval, setBulkInterval] = useState<string>(STABILITY_PULLING_INTERVALS[0]);
  const [bulkRows, setBulkRows] = useState<Array<{
    name: string; code: string; target: number; lower: number; upper: number;
    unit: string; resultType: string; observed: string; remarks: string;
    alertLimitLow?: number; alertLimitHigh?: number; actionLimitLow?: number; actionLimitHigh?: number;
  }>>([]);

  const [scheduleStudyId, setScheduleStudyId] = useState('');
  const [selectedIntervals, setSelectedIntervals] = useState<string[]>([]);
  const [scheduleReason, setScheduleReason] = useState('');
  const [pullReason, setPullReason] = useState('');

  const actor = useMemo(
    () => ({ id: user?.uid || 'system', name: profile?.full_name || 'System', role: role || '' }),
    [user?.uid, profile?.full_name, role],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [studyRows, scheduleRows, resultRows, prods] = await Promise.all([
        fetchStabilityStudies(),
        fetchStabilitySchedules(),
        fetchStabilityResults(),
        fetchProducts(),
      ]);
      setStudies(studyRows);
      setSchedules(scheduleRows);
      setResults(resultRows);
      setProducts(prods);
      await refreshScheduleStatuses(actor);
    } catch {
      setError('Failed to load stability monitoring data.');
    } finally {
      setLoading(false);
    }
  }, [actor]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (productQuery) setSearch(productQuery);
    else if (batchQuery) setSearch(batchQuery);
  }, [productQuery, batchQuery]);

  const filteredResults = useMemo(() => {
    const q = search.toLowerCase();
    return results.filter((r) => {
      if (productQuery && r.productCode !== productQuery && r.productName !== productQuery) return false;
      if (batchQuery && r.batchNumber !== batchQuery) return false;
      if (studyTypeFilter !== 'all' && r.studyType !== studyTypeFilter) return false;
      if (conditionFilter !== 'all' && r.storageCondition !== conditionFilter) return false;
      if (intervalFilter !== 'all' && r.pullingInterval !== intervalFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (dateFrom && (r.testDate || r.createdAt) < dateFrom) return false;
      if (dateTo && (r.testDate || r.createdAt) > dateTo) return false;
      if (!q) return true;
      return (
        r.productName.toLowerCase().includes(q)
        || r.batchNumber.toLowerCase().includes(q)
        || r.stabilityStudyNumber.toLowerCase().includes(q)
        || r.storageCondition.toLowerCase().includes(q)
        || r.pullingInterval.toLowerCase().includes(q)
      );
    });
  }, [results, search, studyTypeFilter, conditionFilter, intervalFilter, statusFilter, riskFilter, dateFrom, dateTo, productQuery, batchQuery]);

  const filteredStudies = useMemo(() => studies.filter((study) =>
    (!productQuery || study.productCode === productQuery || study.productName === productQuery)
    && (!batchQuery || study.batchNumber === batchQuery),
  ), [studies, productQuery, batchQuery]);

  const filteredSchedules = useMemo(() => schedules.filter((schedule) =>
    (!batchQuery || schedule.batchNumber === batchQuery)
    && (!productQuery || filteredStudies.some((study) => study.id === schedule.studyId)),
  ), [schedules, filteredStudies, productQuery, batchQuery]);

  const clearFilters = () => {
    setSearch('');
    setStudyTypeFilter('all');
    setConditionFilter('all');
    setIntervalFilter('all');
    setStatusFilter('all');
    setRiskFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const summary = useMemo(() => summarizeStability(studies, schedules, results), [studies, schedules, results]);
  const charts = useMemo(() => buildStabilityChartSeries(filteredResults, schedules), [filteredResults, schedules]);
  const trendData = useMemo(() => stabilityParameterTrendData(filteredResults, trendParam), [filteredResults, trendParam]);
  const crossLinks = useMemo(() => [
    { href: productQuery ? `/cpv/product-master?search=${encodeURIComponent(productQuery)}` : '/cpv/product-master', label: 'Product' },
    { href: batchQuery ? `/cpv/batch-registration?search=${encodeURIComponent(batchQuery)}` : '/cpv/batch-registration', label: 'Batch' },
    { href: batchQuery ? `/cpv/cpp?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cpp?product=${encodeURIComponent(productQuery)}` : '/cpv/cpp', label: 'CPP' },
    { href: batchQuery ? `/cpv/cqa?batch=${encodeURIComponent(batchQuery)}` : productQuery ? `/cpv/cqa?product=${encodeURIComponent(productQuery)}` : '/cpv/cqa', label: 'CQA' },
    { href: '/cpv/yield-monitoring', label: 'Yield' },
    { href: '/cpv/environmental-monitoring', label: 'Environmental' },
    { href: '/cpv/utility-monitoring', label: 'Utility' },
    { href: '/qms/deviation', label: 'Deviation' }, { href: '/qms/capa', label: 'CAPA' },
    { href: '/cpv/risk-assessment', label: 'Risk' }, { href: '/admin/audit-trail', label: 'Audit Trail' },
    { href: '/cpv/reports-analytics', label: 'Reports' }, { href: '/cpv/statistical-process-control', label: 'SPC' },
    { href: '/cpv/trend-analysis', label: 'Trends' },
  ], [productQuery, batchQuery]);

  const onStudyProductChange = async (productId: string) => {
    setStudyProductId(productId);
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setStudyForm((f) => ({
      ...f,
      cpvProductId: productId,
      productName: p.productName,
      productCode: p.productCode,
      studyStartDate: f.studyStartDate || new Date().toISOString().split('T')[0],
    }));
    const batches = await fetchStabilityBatchesForProduct(p.productName, productId);
    setStudyBatches(batches);
  };

  const onStudyBatchChange = (batchNumber: string) => {
    const batch = studyBatches.find((b) => b.batchNumber === batchNumber);
    setStudyForm((f) => ({
      ...f,
      batchNumber,
      manufacturingDate: batch?.manufacturingDate || f.manufacturingDate || '',
      expiryDate: batch?.expiryDate || f.expiryDate || '',
    }));
  };

  const saveStudy = async () => {
    const parsed = stabilityStudyFormSchema.safeParse(studyForm);
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message || 'Validation failed'); return; }
    setSubmitting(true);
    const data = parsed.data;
    if (editingStudy) {
      const { error: err } = await updateStabilityStudy(editingStudy.id, data, actor, editingStudy);
      if (err) toast.error(err);
      else { toast.success('Study updated'); setStudyFormOpen(false); await load(); }
    } else {
      const { error: err } = await createStabilityStudy(data, actor);
      if (err) toast.error(err);
      else { toast.success('Stability study created'); setStudyFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const onResultStudyChange = (studyId: string) => {
    setSelectedStudyId(studyId);
    const study = studies.find((s) => s.id === studyId);
    if (!study) return;
    setResultForm((f) => ({
      ...f,
      studyId,
      stabilityStudyNumber: study.stabilityStudyNumber,
      cpvProductId: study.cpvProductId,
      productName: study.productName,
      productCode: study.productCode,
      batchNumber: study.batchNumber,
      manufacturingDate: study.manufacturingDate,
      expiryDate: study.expiryDate,
      studyType: study.studyType,
      storageCondition: study.storageCondition,
    }));
  };

  const saveResult = async () => {
    const parsed = stabilityResultFormSchema.safeParse(resultForm);
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message || 'Validation failed'); return; }
    const data = parsed.data;
    const qaOverride = Boolean(editingResult?.isLocked && editingResult.reviewStatus === 'Approved' && canReview);
    if (qaOverride) { setEsignAction('qa-override'); setEsignOpen(true); return; }
    setSubmitting(true);
    if (editingResult) {
      const { error: err } = await updateStabilityResult(editingResult.id, data, actor, editingResult, qaOverride);
      if (err) toast.error(err);
      else { toast.success('Result updated'); setResultFormOpen(false); await load(); }
    } else {
      const { error: err } = await createStabilityResult(data, actor);
      if (err) toast.error(err);
      else { toast.success('Stability result saved'); setResultFormOpen(false); await load(); }
    }
    setSubmitting(false);
  };

  const applyQaOverride = async () => {
    if (!editingResult) return;
    const parsed = stabilityResultFormSchema.safeParse(resultForm);
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message || 'Validation failed'); return; }
    setSubmitting(true);
    const { error: err } = await updateStabilityResult(editingResult.id, parsed.data, actor, editingResult, true, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    if (err) toast.error(err);
    else { toast.success('Result updated (QA override)'); setResultFormOpen(false); await load(); }
  };

  const openBulk = (studyId: string) => {
    const study = studies.find((s) => s.id === studyId);
    if (!study) { toast.error('Select a study first'); return; }
    setBulkStudyId(studyId);
    setBulkProductId(study.cpvProductId);
    setBulkInterval(STABILITY_PULLING_INTERVALS[0]);
    setBulkRows(defaultStabilityParameters().map((p) => ({
      name: p.name,
      code: p.code,
      target: p.target,
      lower: p.lower,
      upper: p.upper,
      unit: p.unit,
      resultType: p.resultType,
      alertLimitLow: p.alertLimitLow,
      alertLimitHigh: p.alertLimitHigh,
      actionLimitLow: p.actionLimitLow,
      actionLimitHigh: p.actionLimitHigh,
      observed: '',
      remarks: '',
    })));
    setBulkOpen(true);
  };

  const saveBulk = async () => {
    const study = studies.find((s) => s.id === bulkStudyId);
    if (!study) { toast.error('Invalid study'); return; }
    const rows: StabilityResultFormData[] = bulkRows.filter((r) => r.observed).map((row) => {
      const isQual = row.resultType === 'Pass/Fail' || row.resultType === 'Complies/Does Not Comply';
      return {
        studyId: study.id,
        stabilityStudyNumber: study.stabilityStudyNumber,
        cpvProductId: study.cpvProductId,
        productName: study.productName,
        productCode: study.productCode,
        batchNumber: study.batchNumber,
        manufacturingDate: study.manufacturingDate,
        expiryDate: study.expiryDate,
        studyType: study.studyType,
        storageCondition: study.storageCondition,
        pullingInterval: bulkInterval as StabilityResultFormData['pullingInterval'],
        samplePullingDueDate: '',
        actualSamplePullingDate: '',
        testDate: new Date().toISOString().split('T')[0],
        parameterCode: row.code,
        parameterName: row.name,
        observedResult: isQual ? row.observed : Number(row.observed),
        targetValue: row.target,
        lowerLimit: row.lower,
        upperLimit: row.upper,
        alertLimitLow: row.alertLimitLow,
        alertLimitHigh: row.alertLimitHigh,
        actionLimitLow: row.actionLimitLow,
        actionLimitHigh: row.actionLimitHigh,
        unit: row.unit,
        resultType: row.resultType as StabilityResultFormData['resultType'],
        analyst: profile?.full_name || '',
        reviewedBy: '',
        reviewDate: '',
        remarks: row.remarks,
        chamberId: study.chamberId || '',
        chamberName: study.chamberName || '',
        changeReason: 'Bulk stability result entry',
      };
    });
    if (!rows.length) { toast.error('Enter at least one observed result'); return; }
    setSubmitting(true);
    const { created, errors } = await bulkCreateStabilityResults(rows, actor, 'Bulk stability result entry');
    setSubmitting(false);
    if (errors.length) toast.error(errors[0]);
    toast.success(`${created} stability results saved`);
    setBulkOpen(false);
    await load();
  };

  const generateSchedule = async () => {
    if (!scheduleStudyId) { toast.error('Select a study'); return; }
    if (scheduleReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
    setSubmitting(true);
    const { schedules: created, error: err } = await generateStabilitySchedule(
      scheduleStudyId,
      selectedIntervals,
      actor,
      scheduleReason,
    );
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success(`${created.length} schedule rows generated`);
      setScheduleOpen(false);
      await load();
    }
  };

  const markPulled = async (scheduleId: string, date: string) => {
    if (pullReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
    const { error: err } = await updateSchedulePull(scheduleId, date, actor, pullReason);
    if (err) toast.error(err);
    else { toast.success('Sample pull updated'); await load(); }
  };

  const exportList = () => {
    downloadCsv('stability-results.csv',
      ['Study', 'Product', 'Batch', 'Interval', 'Parameter', 'Result', 'Status', 'Risk', 'Test Date'],
      filteredResults.map((r) => [
        r.stabilityStudyNumber, r.productName, r.batchNumber, r.pullingInterval,
        r.parameterName, String(r.observedResult), r.status, r.riskLevel, r.testDate,
      ]),
    );
    void logStabilityExport(actor, filteredResults.length);
    toast.success('Export placeholder — CSV downloaded');
  };

  const resultColumns: ColumnDef<StabilityResultRecord>[] = [
    { key: 'stabilityStudyNumber', header: 'Study' },
    { key: 'batchNumber', header: 'Batch' },
    { key: 'pullingInterval', header: 'Interval', render: (r) => <IntervalBadge interval={r.pullingInterval} /> },
    { key: 'parameterName', header: 'Parameter' },
    { key: 'observedResult', header: 'Result' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={r.riskLevel} /> },
    { key: 'storageCondition', header: 'Condition', render: (r) => <StorageConditionBadge condition={r.storageCondition} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/cpv/stability-monitoring/${r.id}`)}>
            <Eye className="h-4 w-4" />
          </Button>
          {!isReadOnly && canEnterResults && (
            <Button variant="ghost" size="icon" onClick={() => {
              setEditingResult(r);
              setResultForm(r);
              setResultFormOpen(true);
            }}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canReview && r.reviewStatus === 'Draft' && (
            <Button variant="ghost" size="icon" onClick={async () => {
              const { error: err } = await reviewStabilityResult(r.id, actor, 'Submitted for QA review');
              if (err) toast.error(err); else { toast.success('Submitted for review'); await load(); }
            }}><CheckCircle className="h-4 w-4" /></Button>
          )}
          {canReview && (r.reviewStatus === 'Under Review' || r.reviewStatus === 'Draft') && (
            <Button variant="outline" size="sm" onClick={() => { setApproveTarget(r); setActionReason(''); setEsignAction('approve'); }}>Approve</Button>
          )}
          {canReview && r.reviewStatus !== 'Approved' && !r.isDeleted && (
            <Button variant="ghost" size="icon" onClick={() => { setDeleteTarget(r); setActionReason(''); setEsignAction('delete'); }}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const studyColumns: ColumnDef<StabilityStudyRecord>[] = [
    { key: 'stabilityStudyNumber', header: 'Study Number' },
    { key: 'productName', header: 'Product' },
    { key: 'batchNumber', header: 'Batch' },
    { key: 'studyType', header: 'Study Type' },
    { key: 'storageCondition', header: 'Condition' },
    { key: 'studyStatus', header: 'Status' },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <div className="flex gap-1 flex-wrap">
          {canCreateStudy && (
            <Button variant="ghost" size="icon" onClick={() => {
              setEditingStudy(s);
              setStudyForm(s);
              setStudyProductId(s.cpvProductId);
              void onStudyProductChange(s.cpvProductId);
              setStudyFormOpen(true);
            }}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canCreateStudy && (
            <Button variant="ghost" size="sm" onClick={() => {
              setScheduleStudyId(s.id);
              setSelectedIntervals([]);
              setScheduleReason('');
              setScheduleOpen(true);
            }}>
              <Calendar className="h-4 w-4 mr-1" />Schedule
            </Button>
          )}
          {canEnterResults && (
            <Button variant="ghost" size="sm" onClick={() => openBulk(s.id)}>
              <Layers className="h-4 w-4 mr-1" />Bulk
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
        title="Stability Monitoring"
        description="Monitor stability schedules, sample pulling, results and trends for CPV products"
        trail={[
          { label: 'CPV Dashboard', href: '/cpv/dashboard' },
          { label: 'Stability Monitoring' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" onClick={() => toast.info('Excel import placeholder — upload template coming soon')}>
                Import Excel
              </Button>
            )}
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2" onClick={exportList}>
                <Download className="h-4 w-4" />Export
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => printPage()}><Printer className="h-4 w-4" />Print</Button>
            {canCreateStudy && (
              <Button size="sm" className="gap-2" onClick={() => {
                setEditingStudy(null);
                setStudyForm({ studyStartDate: new Date().toISOString().split('T')[0], studyType: 'Long Term', storageCondition: '25°C / 60% RH', changeReason: '' });
                setStudyFormOpen(true);
              }}>
                <Plus className="h-4 w-4" />New Study
              </Button>
            )}
            {canEnterResults && (
              <Button size="sm" className="gap-2" onClick={() => {
                setEditingResult(null);
                setResultForm({
                  testDate: new Date().toISOString().split('T')[0],
                  analyst: profile?.full_name || '',
                  pullingInterval: 'Initial',
                });
                setResultFormOpen(true);
              }}>
                <Plus className="h-4 w-4" />Enter Result
              </Button>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {crossLinks.map((link) => (
          <Link key={link.href + link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Total Studies" value={summary.totalStudies} />
        <KpiCard label="Ongoing" value={summary.ongoingStudies} />
        <KpiCard label="Completed" value={summary.completedStudies} tone="green" />
        <KpiCard label="Samples Due" value={summary.samplesDue} />
        <KpiCard label="Samples Missed" value={summary.samplesMissed} tone={summary.samplesMissed > 0 ? 'amber' : 'blue'} />
        <KpiCard label="OOS Results" value={summary.oosResults} tone={summary.oosResults > 0 ? 'red' : 'blue'} />
        <KpiCard label="OOT Results" value={summary.ootResults} />
        <KpiCard label="Compliant" value={summary.compliantResults} tone="green" />
        <KpiCard label="High Risk" value={summary.highRiskStudies} tone="amber" />
        <KpiCard label="CAPA Suggested" value={summary.capaSuggested} />
      </div>

      <div className="flex flex-wrap gap-2">
        {(['results', 'studies', 'schedules'] as const).map((tab) => (
          <Button key={tab} variant={viewTab === tab ? 'default' : 'outline'} size="sm" onClick={() => setViewTab(tab)}>
            {tab === 'results' ? 'Results' : tab === 'studies' ? 'Studies' : 'Sample Pulling'}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <CardTitle className="text-base">Filters</CardTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={studyTypeFilter} onValueChange={setStudyTypeFilter}>
                <SelectTrigger><SelectValue placeholder="Study type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {STABILITY_STUDY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={conditionFilter} onValueChange={setConditionFilter}>
                <SelectTrigger><SelectValue placeholder="Condition" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All conditions</SelectItem>
                  {STABILITY_STORAGE_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={intervalFilter} onValueChange={setIntervalFilter}>
                <SelectTrigger><SelectValue placeholder="Interval" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All intervals</SelectItem>
                  {STABILITY_PULLING_INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STABILITY_RESULT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
              <Button variant="outline" size="sm" className="gap-1" onClick={clearFilters}><FilterX className="h-3.5 w-3.5" />Clear</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewTab === 'results' && (
            filteredResults.length
              ? <ResponsiveDataTable columns={resultColumns} data={filteredResults} pageSize={10} mobileTitleKey="batchNumber" mobileSubtitleKey="parameterName" />
              : <EmptyState title="No stability results" message="Create a study and enter results to begin monitoring." />
          )}
          {viewTab === 'studies' && (
            filteredStudies.length
              ? <ResponsiveDataTable columns={studyColumns} data={filteredStudies} pageSize={10} mobileTitleKey="stabilityStudyNumber" mobileSubtitleKey="batchNumber" />
              : <EmptyState title="No stability studies" message="Create a stability study to generate schedules." />
          )}
          {viewTab === 'schedules' && (
            filteredSchedules.length ? (
              <div className="overflow-x-auto">
                <div className="mb-3 max-w-md">
                  <Label>Sample Pull Change Reason *</Label>
                  <Input className="mt-1" value={pullReason} onChange={(e) => setPullReason(e.target.value)} placeholder="Minimum 5 characters (ALCOA+)" />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Study</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Interval</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actual Pull</TableHead>
                      {canUpdatePull && <TableHead>Action</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSchedules.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">{s.stabilityStudyNumber}</TableCell>
                        <TableCell>{s.batchNumber}</TableCell>
                        <TableCell><IntervalBadge interval={s.interval} /></TableCell>
                        <TableCell>{s.samplePullingDueDate}</TableCell>
                        <TableCell><ScheduleBadge status={s.scheduleStatus} /></TableCell>
                        <TableCell>{s.actualPullingDate || '—'}</TableCell>
                        {canUpdatePull && (
                          <TableCell>
                            {!s.actualPullingDate && (
                              <Button size="sm" variant="outline" onClick={() => markPulled(s.id, new Date().toISOString().split('T')[0])}>
                                Mark Pulled
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState title="No schedules" message="Generate a pulling schedule from a stability study." />
            )
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Assay Stability Trend</CardTitle>
            <Select value={trendParam} onValueChange={setTrendParam}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['Assay', 'pH', 'Related Substances', 'Preservative Content'].map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ParameterTrendChart data={trendData} title={trendParam} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">OOT / OOS Trend</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.ootOosTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts.ootOosTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="oot" stroke="#d97706" name="OOT" />
                  <Line type="monotone" dataKey="oos" stroke="#dc2626" name="OOS" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No OOT/OOS data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Interval Compliance</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.intervalCompliance.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.intervalCompliance}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="interval" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="rate" fill="#2563eb" name="Compliance %" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No compliance data</div>
            )}
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
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No risk data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Storage Condition Non-Compliance</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.storageConditionTrend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.storageConditionTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="condition" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#7c3aed" name="OOT/OOS/Action" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No condition trend data</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Batch-wise Stability Summary</CardTitle></CardHeader>
          <CardContent className="h-[300px]">
            {charts.batchSummary.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.batchSummary}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="batch" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="compliance" fill="#059669" name="Compliance %" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No batch summary data</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={studyFormOpen} onOpenChange={setStudyFormOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>{editingStudy ? 'Edit Study' : 'Create Stability Study'}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label>Product *</Label>
              <Select value={studyProductId} onValueChange={onStudyProductChange}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Batch *</Label>
              <Select value={studyForm.batchNumber || ''} onValueChange={onStudyBatchChange}>
                <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                <SelectContent>
                  {studyBatches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Study Type *</Label>
                <Select value={studyForm.studyType || 'Long Term'} onValueChange={(v) => setStudyForm((f) => ({ ...f, studyType: v as StabilityStudyFormData['studyType'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STABILITY_STUDY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Storage Condition *</Label>
                <Select value={studyForm.storageCondition || '25°C / 60% RH'} onValueChange={(v) => setStudyForm((f) => ({ ...f, storageCondition: v as StabilityStudyFormData['storageCondition'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STABILITY_STORAGE_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Product Version</Label><Input value={studyForm.productVersion || ''} onChange={(e) => setStudyForm((f) => ({ ...f, productVersion: e.target.value }))} /></div>
              <div><Label>Strength</Label><Input value={studyForm.strength || ''} onChange={(e) => setStudyForm((f) => ({ ...f, strength: e.target.value }))} /></div>
              <div><Label>Dosage Form</Label><Input value={studyForm.dosageForm || ''} onChange={(e) => setStudyForm((f) => ({ ...f, dosageForm: e.target.value }))} /></div>
              <div><Label>Pack Size</Label><Input value={studyForm.packSize || ''} onChange={(e) => setStudyForm((f) => ({ ...f, packSize: e.target.value }))} /></div>
              <div><Label>Packaging Type</Label><Input value={studyForm.packagingType || ''} onChange={(e) => setStudyForm((f) => ({ ...f, packagingType: e.target.value }))} /></div>
              <div><Label>Shelf Life (Months)</Label><Input type="number" value={studyForm.shelfLifeMonths ?? ''} onChange={(e) => setStudyForm((f) => ({ ...f, shelfLifeMonths: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Protocol Version</Label><Input value={studyForm.protocolVersion || ''} onChange={(e) => setStudyForm((f) => ({ ...f, protocolVersion: e.target.value }))} /></div>
              <div><Label>Specification Version</Label><Input value={studyForm.specificationVersion || ''} onChange={(e) => setStudyForm((f) => ({ ...f, specificationVersion: e.target.value }))} /></div>
              <div><Label>Site</Label><Input value={studyForm.site || ''} onChange={(e) => setStudyForm((f) => ({ ...f, site: e.target.value }))} /></div>
              <div><Label>Department</Label><Input value={studyForm.department || ''} onChange={(e) => setStudyForm((f) => ({ ...f, department: e.target.value }))} /></div>
              <div><Label>Chamber ID</Label><Input value={studyForm.chamberId || ''} onChange={(e) => setStudyForm((f) => ({ ...f, chamberId: e.target.value }))} /></div>
              <div><Label>Chamber Name</Label><Input value={studyForm.chamberName || ''} onChange={(e) => setStudyForm((f) => ({ ...f, chamberName: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Study Start Date *</Label>
                <Input type="date" value={studyForm.studyStartDate || ''} onChange={(e) => setStudyForm((f) => ({ ...f, studyStartDate: e.target.value }))} />
              </div>
              <div>
                <Label>Study End Date</Label>
                <Input type="date" value={studyForm.studyEndDate || ''} onChange={(e) => setStudyForm((f) => ({ ...f, studyEndDate: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea value={studyForm.remarks || ''} onChange={(e) => setStudyForm((f) => ({ ...f, remarks: e.target.value }))} />
            </div>
            <div>
              <Label>Change Reason *</Label>
              <Textarea value={studyForm.changeReason || ''} onChange={(e) => setStudyForm((f) => ({ ...f, changeReason: e.target.value }))} placeholder="Minimum 5 characters (ALCOA+)" />
            </div>
            <Button className="w-full" disabled={submitting} onClick={saveStudy}>
              {submitting ? 'Saving…' : 'Save Study'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={resultFormOpen} onOpenChange={setResultFormOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>{editingResult ? 'Edit Result' : 'Enter Stability Result'}</SheetTitle></SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <Label>Study *</Label>
              <Select value={selectedStudyId || resultForm.studyId || ''} onValueChange={onResultStudyChange}>
                <SelectTrigger><SelectValue placeholder="Select study" /></SelectTrigger>
                <SelectContent>
                  {studies.map((s) => <SelectItem key={s.id} value={s.id}>{s.stabilityStudyNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Interval *</Label>
                <Select value={resultForm.pullingInterval || 'Initial'} onValueChange={(v) => setResultForm((f) => ({ ...f, pullingInterval: v as StabilityResultFormData['pullingInterval'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STABILITY_PULLING_INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Parameter *</Label>
                <Select
                  value={resultForm.parameterName || ''}
                  onValueChange={(name) => {
                    const limits = defaultStabilityParameters().find((p) => p.name === name);
                    if (!limits) return;
                    setResultForm((f) => ({
                      ...f,
                      parameterName: name,
                      parameterCode: limits.code,
                      targetValue: limits.target,
                      lowerLimit: limits.lower,
                      upperLimit: limits.upper,
                      alertLimitLow: limits.alertLimitLow,
                      alertLimitHigh: limits.alertLimitHigh,
                      actionLimitLow: limits.actionLimitLow,
                      actionLimitHigh: limits.actionLimitHigh,
                      unit: limits.unit,
                      resultType: limits.resultType as StabilityResultFormData['resultType'],
                    }));
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Parameter" /></SelectTrigger>
                  <SelectContent>
                    {DEFAULT_STABILITY_PARAMETERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Observed Result *</Label>
              <Input
                value={String(resultForm.observedResult ?? '')}
                onChange={(e) => {
                  const observed = resultForm.resultType === 'Numeric' ? Number(e.target.value) : e.target.value;
                  const partial = { ...resultForm, observedResult: observed } as StabilityResultFormData;
                  const computed = buildStabilityComputedFields(partial);
                  setComputedStatus(computed.status);
                  setResultForm((f) => ({ ...f, observedResult: observed }));
                }}
              />
              {computedStatus && <p className="mt-1 text-xs text-muted-foreground">Auto status: {computedStatus}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Test Date *</Label>
                <Input type="date" value={resultForm.testDate?.split('T')[0] || ''} onChange={(e) => setResultForm((f) => ({ ...f, testDate: e.target.value }))} />
              </div>
              <div>
                <Label>Analyst *</Label>
                <Input value={resultForm.analyst || ''} onChange={(e) => setResultForm((f) => ({ ...f, analyst: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Chamber ID</Label><Input value={resultForm.chamberId || ''} onChange={(e) => setResultForm((f) => ({ ...f, chamberId: e.target.value }))} /></div>
              <div><Label>Chamber Name</Label><Input value={resultForm.chamberName || ''} onChange={(e) => setResultForm((f) => ({ ...f, chamberName: e.target.value }))} /></div>
              <div><Label>Alert Low</Label><Input type="number" value={resultForm.alertLimitLow ?? ''} onChange={(e) => setResultForm((f) => ({ ...f, alertLimitLow: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Alert High</Label><Input type="number" value={resultForm.alertLimitHigh ?? ''} onChange={(e) => setResultForm((f) => ({ ...f, alertLimitHigh: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Action Low</Label><Input type="number" value={resultForm.actionLimitLow ?? ''} onChange={(e) => setResultForm((f) => ({ ...f, actionLimitLow: e.target.value ? Number(e.target.value) : undefined }))} /></div>
              <div><Label>Action High</Label><Input type="number" value={resultForm.actionLimitHigh ?? ''} onChange={(e) => setResultForm((f) => ({ ...f, actionLimitHigh: e.target.value ? Number(e.target.value) : undefined }))} /></div>
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea value={resultForm.remarks || ''} onChange={(e) => setResultForm((f) => ({ ...f, remarks: e.target.value }))} />
            </div>
            <div>
              <Label>Change Reason *</Label>
              <Textarea value={resultForm.changeReason || ''} onChange={(e) => setResultForm((f) => ({ ...f, changeReason: e.target.value }))} placeholder="Minimum 5 characters (ALCOA+)" />
            </div>
            <Button className="w-full" disabled={submitting} onClick={saveResult}>
              {submitting ? 'Saving…' : 'Save Result'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Bulk Stability Result Entry</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 mb-4">
            <div>
              <Label>Pulling Interval</Label>
              <Select value={bulkInterval} onValueChange={setBulkInterval}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STABILITY_PULLING_INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Parameter</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>LSL</TableHead>
                  <TableHead>USL</TableHead>
                  <TableHead>Observed</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bulkRows.map((row, idx) => (
                  <TableRow key={row.code}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.target}</TableCell>
                    <TableCell>{row.lower}</TableCell>
                    <TableCell>{row.upper}</TableCell>
                    <TableCell>
                      <Input
                        className="h-8"
                        value={row.observed}
                        onChange={(e) => {
                          const next = [...bulkRows];
                          next[idx] = { ...row, observed: e.target.value };
                          setBulkRows(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8"
                        value={row.remarks}
                        onChange={(e) => {
                          const next = [...bulkRows];
                          next[idx] = { ...row, remarks: e.target.value };
                          setBulkRows(next);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button disabled={submitting} onClick={saveBulk}>{submitting ? 'Saving…' : 'Save All'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate Pulling Schedule</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Select intervals or leave empty to use defaults for study type.</p>
          <div><Label>Change Reason *</Label><Textarea className="mt-1" value={scheduleReason} onChange={(e) => setScheduleReason(e.target.value)} placeholder="Minimum 5 characters (ALCOA+)" /></div>
          <div className="flex flex-wrap gap-2 py-4">
            {STABILITY_PULLING_INTERVALS.map((interval) => {
              const selected = selectedIntervals.includes(interval);
              return (
                <Button
                  key={interval}
                  size="sm"
                  variant={selected ? 'default' : 'outline'}
                  onClick={() => setSelectedIntervals((prev) =>
                    selected ? prev.filter((i) => i !== interval) : [...prev, interval],
                  )}
                >
                  {interval}
                </Button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button disabled={submitting} onClick={generateSchedule}>{submitting ? 'Generating…' : 'Generate'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(approveTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve Stability Result</DialogTitle><DialogDescription>Change reason and electronic signature required (Part 11 / ALCOA+).</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button><Button disabled={submitting} onClick={() => {
            if (actionReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
            setEsignAction('approve'); setEsignOpen(true);
          }}>Continue to E-Sign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget) && !esignOpen} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Soft-Delete Stability Result</DialogTitle><DialogDescription>Archive this record with a change reason and electronic signature.</DialogDescription></DialogHeader>
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
        moduleName="Stability Monitoring"
        recordId={(esignAction === 'approve' ? approveTarget : esignAction === 'delete' ? deleteTarget : editingResult)?.id || ''}
        documentNumber={(esignAction === 'approve' ? approveTarget : esignAction === 'delete' ? deleteTarget : editingResult)?.stabilityMonitoringId || ''}
        actionType={esignAction === 'approve' ? 'Approve' : esignAction === 'delete' ? 'Soft Delete' : 'QA Override'}
        onSuccess={() => {
          if (esignAction === 'approve' && approveTarget) {
            void (async () => {
              setSubmitting(true);
              const { error: err } = await approveStabilityResult(approveTarget.id, actor, actionReason, { esignConfirmed: true });
              setSubmitting(false); setEsignOpen(false); setApproveTarget(null); setActionReason('');
              if (err) toast.error(err); else { toast.success('Result approved'); await load(); }
            })();
          } else if (esignAction === 'delete' && deleteTarget) {
            void (async () => {
              setSubmitting(true);
              const { error: err } = await softDeleteStabilityResult(deleteTarget.id, actor, actionReason, { esignConfirmed: true });
              setSubmitting(false); setEsignOpen(false); setDeleteTarget(null); setActionReason('');
              if (err) toast.error(err); else { toast.success('Result soft-deleted'); await load(); }
            })();
          } else void applyQaOverride();
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
