'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft, ChevronRight, Download, Eye, FileSpreadsheet, Loader2, Pencil, Plus, RefreshCw, Save, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  PQR_SECTION_FLOW, pqrSectionHref, type PqrOption,
} from '@/lib/pqr-batch-review-records';
import { fetchPqrById } from '@/lib/pqr-batch-review-service';
import {
  STABILITY_PULLING_INTERVALS,
  STABILITY_STORAGE_CONDITIONS,
  STABILITY_STUDY_TYPES,
  PQR_STABILITY_RESULT_STATUSES,
  PQR_RISK_LEVELS,
  canAddStabilityReview,
  canExportStabilityReview,
  canManageStabilityReview,
  canPullStabilityReview,
  computeStabilityReviewSummary,
  filterStabilityReviewRecords,
  type PqrStabilityReviewRecord,
  type StabilityReviewFormData,
} from '@/lib/pqr-stability-review-records';
import {
  buildStabilityReviewCharts,
  createStabilityReviewRecord,
  deleteStabilityReviewAttachment,
  exportStabilityReviewCsv,
  fetchStabilityQualityMetrics,
  fetchStabilityReviewRecords,
  fetchPqrOptions,
  getStabilityReviewNarrative,
  logStabilityNarrativeEdit,
  logStabilityReviewExport,
  logStabilityReviewView,
  pullStabilityReviewData,
  recalculateAllStabilityCompliance,
  saveStabilitySectionToPqr,
  softDeleteStabilityReviewRecord,
  updateStabilityReviewRecord,
  uploadStabilityReviewAttachment,
} from '@/lib/pqr-stability-review-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AttachmentUploader } from '@/components/pqr/create/attachment-uploader';
import { ParameterTrendChart } from '@/components/pqr/utility-environmental-review/parameter-trend-chart';
import { StabilityReviewAccessGuard } from './stability-review-access-guard';
import { StabilityReviewFormDialog } from './stability-review-form-dialog';
import {
  ComplianceBadge, IntervalBadge, OotOosBadge, ResultStatusBadge, RiskBadge, StorageConditionBadge,
} from './stability-review-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ColumnDef } from '@/components/admin/admin-data-table';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#64748b'];

function SafeChart({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-52">{empty ? <EmptyState title="No data" message="No chart data." /> : children}</CardContent>
    </Card>
  );
}

type TableRow = PqrStabilityReviewRecord & { srNo: number };

export function StabilityReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canManage = canManageStabilityReview(role);
  const canAdd = canAddStabilityReview(role);
  const canPull = canPullStabilityReview(role);
  const canExport = canExportStabilityReview(role);

  const [pqrs, setPqrs] = useState<PqrOption[]>([]);
  const [selectedPqrId, setSelectedPqrId] = useState('');
  const [records, setRecords] = useState<PqrStabilityReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState('');
  const [narrativeDirty, setNarrativeDirty] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<PqrStabilityReviewRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<PqrStabilityReviewRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [filterBatch, setFilterBatch] = useState('');
  const [filterStudyType, setFilterStudyType] = useState('all');
  const [filterStorage, setFilterStorage] = useState('all');
  const [filterInterval, setFilterInterval] = useState('all');
  const [filterParameter, setFilterParameter] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRisk, setFilterRisk] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [qualityMetrics, setQualityMetrics] = useState({
    stabilityDeviations: 0, stabilityOos: 0, stabilityCapa: 0, stabilityChangeControls: 0,
  });

  const narrativeAuditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
  }), [user?.uid, profile?.full_name, profile?.email, role]);

  const selectedPqr = useMemo(() => pqrs.find((p) => p.id === selectedPqrId) || null, [pqrs, selectedPqrId]);

  const syncPqrIdToUrl = useCallback((pqrId: string) => {
    if (!pqrId) return;
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (params.get('pqrId') === pqrId) return;
    params.set('pqrId', pqrId);
    router.replace(`/pqr/stability?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const loadPqrs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) { setError('Firebase is not configured.'); return; }
      const opts = await fetchPqrOptions();
      setPqrs(opts);
      const fromUrl = searchParams?.get('pqrId') || '';
      let nextId = selectedPqrId;
      if (fromUrl && opts.some((p) => p.id === fromUrl)) {
        nextId = fromUrl;
      } else if (fromUrl) {
        const direct = await fetchPqrById(fromUrl);
        if (direct) {
          setPqrs((prev) => (prev.some((p) => p.id === direct.id) ? prev : [direct, ...prev]));
          nextId = direct.id;
        } else if (!nextId && opts.length) nextId = opts[0].id;
      } else if (!nextId && opts.length) {
        nextId = opts[0].id;
      }
      if (nextId) {
        setSelectedPqrId(nextId);
        syncPqrIdToUrl(nextId);
      }
    } catch { setError('Failed to load PQR records.'); }
    finally { setLoading(false); }
  }, [selectedPqrId, searchParams, syncPqrIdToUrl]);

  const loadRecords = useCallback(async (pqrId: string, pqr?: PqrOption | null) => {
    if (!pqrId) return;
    setBusy(true);
    try {
      const rows = await fetchStabilityReviewRecords(pqrId);
      setRecords(rows);
      setNarrative(getStabilityReviewNarrative(rows));
      setNarrativeDirty(false);
      if (pqr) {
        const metrics = await fetchStabilityQualityMetrics(pqr, rows);
        setQualityMetrics(metrics);
      }
    } catch { toast.error('Failed to load stability review records'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadPqrs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const viewLogged = useRef(false);
  useEffect(() => {
    if (viewLogged.current || actor.id === 'system') return;
    viewLogged.current = true;
    void logStabilityReviewView(actor);
  }, [actor]);

  useEffect(() => {
    if (selectedPqrId) {
      void loadRecords(selectedPqrId, selectedPqr);
      syncPqrIdToUrl(selectedPqrId);
    }
  }, [selectedPqrId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (narrativeAuditTimer.current) clearTimeout(narrativeAuditTimer.current);
  }, []);

  const filtered = useMemo(() => {
    const base = filterStabilityReviewRecords(records, {
      batch: filterBatch,
      studyType: filterStudyType,
      storageCondition: filterStorage,
      pullingInterval: filterInterval,
      parameter: filterParameter,
      resultStatus: filterStatus,
      riskLevel: filterRisk,
      search: filterSearch,
    });
    if (!filterDateFrom && !filterDateTo) return base;
    return base.filter((r) => {
      if (filterDateFrom && r.testDate < filterDateFrom) return false;
      if (filterDateTo && r.testDate > filterDateTo) return false;
      return true;
    });
  }, [
    records, filterBatch, filterStudyType, filterStorage, filterInterval,
    filterParameter, filterStatus, filterRisk, filterSearch, filterDateFrom, filterDateTo,
  ]);

  const longTermRecords = useMemo(() => filtered.filter((r) => r.studyType === 'Long Term'), [filtered]);
  const acceleratedRecords = useMemo(() => filtered.filter((r) => r.studyType === 'Accelerated'), [filtered]);
  const intermediateRecords = useMemo(() => filtered.filter((r) => r.studyType === 'Intermediate'), [filtered]);
  const samplePullRecords = useMemo(() => filtered.filter((r) =>
    r.samplePullingDueDate || r.actualPullingDate || (r.samplePullStatus || '').toLowerCase() === 'missed',
  ), [filtered]);
  const ootOosRecords = useMemo(() => filtered.filter((r) =>
    r.resultStatus === 'OOT' || r.resultStatus === 'OOS' || r.ootCount > 0 || r.oosCount > 0,
  ), [filtered]);
  const summary = useMemo(() => computeStabilityReviewSummary(filtered), [filtered]);
  const charts = useMemo(() => buildStabilityReviewCharts(filtered), [filtered]);

  const sectionNav = useMemo(() => {
    const idx = PQR_SECTION_FLOW.findIndex((s) => s.key === 'stability');
    const prev = PQR_SECTION_FLOW[idx - 1];
    const next = PQR_SECTION_FLOW[idx + 1];
    return {
      prev: prev ? { ...prev, href: pqrSectionHref(prev.href, selectedPqrId) } : null,
      next: next ? { ...next, href: pqrSectionHref(next.href, selectedPqrId) } : null,
    };
  }, [selectedPqrId]);

  const resetFilters = () => {
    setFilterBatch('');
    setFilterStudyType('all');
    setFilterStorage('all');
    setFilterInterval('all');
    setFilterParameter('');
    setFilterStatus('all');
    setFilterRisk('all');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterSearch('');
  };

  const tableColumns: ColumnDef<TableRow>[] = [
    { key: 'srNo', header: 'Sr. No.' },
    { key: 'batchNumber', header: 'Batch No.' },
    { key: 'studyType', header: 'Study Type', render: (r) => <span className="text-xs">{r.studyType}</span> },
    { key: 'storageCondition', header: 'Storage Condition', render: (r) => <StorageConditionBadge condition={r.storageCondition} /> },
    { key: 'pullingInterval', header: 'Interval', render: (r) => <IntervalBadge interval={r.pullingInterval} /> },
    { key: 'parameterName', header: 'Parameter' },
    { key: 'observedResult', header: 'Observed Result', render: (r) => `${r.observedResult}${r.unit ? ` ${r.unit}` : ''}` },
    { key: 'specification', header: 'Specification', render: (r) => `${r.lowerLimit}–${r.upperLimit}` },
    { key: 'resultStatus', header: 'Status', render: (r) => <ResultStatusBadge status={r.resultStatus} /> },
    { key: 'ootOos', header: 'OOT/OOS', render: (r) => <OotOosBadge oot={r.ootCount} oos={r.oosCount} /> },
    { key: 'remarks', header: 'Remarks', render: (r) => <span className="line-clamp-1 max-w-[80px]">{r.remarks || '—'}</span> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`View ${r.batchNumber} ${r.parameterName}`} onClick={() => setDetailRecord(r)}><Eye className="h-4 w-4" /></Button>
          {canManage && (
            <>
              <Button variant="ghost" size="icon" aria-label={`Edit ${r.batchNumber} ${r.parameterName}`} onClick={() => { setEditRecord(r); setFormOpen(true); }}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${r.batchNumber} ${r.parameterName}`} onClick={() => setDeleteId(r.id || null)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const toTable = (rows: PqrStabilityReviewRecord[]): TableRow[] => rows.map((r, i) => ({ ...r, srNo: i + 1 }));
  const renderTable = (rows: PqrStabilityReviewRecord[], emptyTitle: string) => (
    rows.length ? (
      <ResponsiveDataTable
        columns={tableColumns}
        data={toTable(rows)}
        searchKeys={['batchNumber', 'parameterName', 'studyNumber']}
        mobileTitleKey="batchNumber"
        mobileSubtitleKey="parameterName"
        pageSize={15}
      />
    ) : <EmptyState title={emptyTitle} message="Pull stability data or add manually." />
  );

  const handlePull = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { created, skipped, error: err } = await pullStabilityReviewData(selectedPqr, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`${created} stability record(s) pulled (${skipped} skipped)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveForm = async (data: StabilityReviewFormData): Promise<void> => {
    if (!selectedPqr) return;
    setBusy(true);
    const result = editRecord?.id
      ? await updateStabilityReviewRecord(editRecord.id, data, actor)
      : await createStabilityReviewRecord(selectedPqr, data, actor);
    setBusy(false);
    if (result.error) { toast.error(result.error); return; }
    toast.success(editRecord ? 'Record updated' : 'Record added');
    setFormOpen(false);
    setEditRecord(null);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveSection = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { error: err } = await saveStabilitySectionToPqr(selectedPqr.id, narrative, records, actor);
    setBusy(false);
    if (err) toast.error(err);
    else {
      setNarrativeDirty(false);
      toast.success('Section saved to PQR');
    }
  };

  const handleRecalc = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { updated, error: err } = await recalculateAllStabilityCompliance(selectedPqr.id, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`Compliance and risk recalculated for ${updated} record(s)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteId || !selectedPqr) return;
    setBusy(true);
    const { error: err } = await softDeleteStabilityReviewRecord(deleteId, actor);
    setBusy(false);
    setDeleteId(null);
    if (err) { toast.error(err); return; }
    toast.success('Record removed');
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('No records to export');
    exportStabilityReviewCsv(filtered, selectedPqr?.pqrNumber);
    void logStabilityReviewExport(actor, 'csv');
    toast.success('Stability review exported as CSV');
  };

  const onNarrativeChange = (value: string) => {
    setNarrative(value);
    setNarrativeDirty(true);
    if (!selectedPqr) return;
    if (narrativeAuditTimer.current) clearTimeout(narrativeAuditTimer.current);
    narrativeAuditTimer.current = setTimeout(() => {
      void logStabilityNarrativeEdit(actor, selectedPqr.id);
    }, 1500);
  };

  const trendToParamChart = (points: Array<{ label: string; observed: number }>) =>
    points.map((p) => ({ month: p.label, value: p.observed }));

  if (loading) return <StabilityReviewAccessGuard><div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div></StabilityReviewAccessGuard>;
  if (error) return <StabilityReviewAccessGuard><div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void loadPqrs()} /></div></StabilityReviewAccessGuard>;

  return (
    <StabilityReviewAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Stability Review"
          description="Review stability study results, OOT/OOS trends and shelf-life impact during PQR period"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'Stability Review' },
          ]}
          actions={(
            <>
              {canExport && (
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" />Export CSV
                </Button>
              )}
              {canPull && selectedPqr && (
                <Button variant="outline" size="sm" onClick={() => void handlePull()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                  Pull Data
                </Button>
              )}
              {canManage && selectedPqr && (
                <Button variant="outline" size="sm" onClick={() => void handleRecalc()} disabled={busy}>Recalc</Button>
              )}
              {canAdd && selectedPqr && (
                <Button size="sm" onClick={() => { setEditRecord(null); setFormOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add</Button>
              )}
            </>
          )}
        />

        <div className="flex flex-wrap gap-2 text-sm">
          {PQR_SECTION_FLOW.filter((s) => !['dashboard', 'create'].includes(s.key)).map((s) => (
            <Link
              key={s.key}
              href={pqrSectionHref(s.href, selectedPqrId)}
              className={`rounded-md border px-2.5 py-1 ${s.key === 'stability' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50'}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <Card><CardContent className="pt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pqr-select-stability">PQR Number *</Label>
              <Select
                value={selectedPqrId}
                onValueChange={(id) => {
                  setSelectedPqrId(id);
                  syncPqrIdToUrl(id);
                }}
              >
                <SelectTrigger id="pqr-select-stability"><SelectValue placeholder="Select PQR..." /></SelectTrigger>
                <SelectContent>{pqrs.map((p) => <SelectItem key={p.id} value={p.id}>{p.pqrNumber} — {p.productName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {selectedPqr && (
              <>
                <div>
                  <Label className="text-muted-foreground">Product / Code</Label>
                  <p className="text-sm font-medium">{selectedPqr.productName}</p>
                  <p className="text-xs text-muted-foreground">{selectedPqr.productCode}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Review Period</Label>
                  <p className="text-sm font-medium">{selectedPqr.reviewPeriodFrom || '—'} — {selectedPqr.reviewPeriodTo || '—'}</p>
                </div>
                {(selectedPqr.strength || selectedPqr.dosageForm) && (
                  <div>
                    <Label className="text-muted-foreground">Strength / Dosage Form</Label>
                    <p className="text-sm font-medium">{[selectedPqr.strength, selectedPqr.dosageForm].filter(Boolean).join(' / ')}</p>
                  </div>
                )}
                {selectedPqr.site && (
                  <div>
                    <Label className="text-muted-foreground">Manufacturing Site</Label>
                    <p className="text-sm font-medium">{selectedPqr.site}</p>
                  </div>
                )}
                {selectedPqr.status && (
                  <div>
                    <Label className="text-muted-foreground">PQR Status</Label>
                    <p className="text-sm font-medium capitalize">{selectedPqr.status.replace(/_/g, ' ')}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent></Card>

        {!selectedPqr ? (
          <EmptyState title="Select a PQR" message="Choose a PQR to review stability study data." />
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-12">
              <KpiCard label="Total Studies" value={summary.totalStabilityStudies} />
              <KpiCard label="Stability Batches" value={summary.totalStabilityBatches} />
              <KpiCard label="Samples Due" value={summary.samplesDue} tone="amber" />
              <KpiCard label="Samples Missed" value={summary.samplesMissed} tone="red" />
              <KpiCard label="Compliant Results" value={summary.compliantResults} tone="green" />
              <KpiCard label="OOT Results" value={summary.ootResults} tone="amber" />
              <KpiCard label="OOS Results" value={Math.max(summary.oosResults, qualityMetrics.stabilityOos)} tone="red" />
              <KpiCard label="CAPA Linked" value={qualityMetrics.stabilityCapa || summary.capaLinked} />
              <KpiCard label="Deviations" value={qualityMetrics.stabilityDeviations} />
              <KpiCard label="Change Controls" value={qualityMetrics.stabilityChangeControls} />
              <KpiCard label="High Risk" value={summary.highRiskStudies} tone="amber" />
              <KpiCard label="Critical Risk" value={summary.criticalRiskStudies} tone="red" />
            </div>

            <Card><CardContent className="pt-6">
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Search batch / parameter"
                  className="w-full sm:w-[200px]"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  aria-label="Search stability records"
                />
                <Input placeholder="Batch No." className="w-[120px]" value={filterBatch} onChange={(e) => setFilterBatch(e.target.value)} aria-label="Filter batch number" />
                <Select value={filterStudyType} onValueChange={setFilterStudyType}>
                  <SelectTrigger className="w-[140px]" aria-label="Filter study type"><SelectValue placeholder="Study Type" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Study Types</SelectItem>{STABILITY_STUDY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterStorage} onValueChange={setFilterStorage}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter storage condition"><SelectValue placeholder="Storage" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Conditions</SelectItem>{STABILITY_STORAGE_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterInterval} onValueChange={setFilterInterval}>
                  <SelectTrigger className="w-[120px]" aria-label="Filter pulling interval"><SelectValue placeholder="Interval" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Intervals</SelectItem>{STABILITY_PULLING_INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                </Select>
                <Input placeholder="Parameter" className="w-[120px]" value={filterParameter} onChange={(e) => setFilterParameter(e.target.value)} aria-label="Filter parameter" />
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[130px]" aria-label="Filter result status"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Status</SelectItem>{PQR_STABILITY_RESULT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterRisk} onValueChange={setFilterRisk}>
                  <SelectTrigger className="w-[110px]" aria-label="Filter risk level"><SelectValue placeholder="Risk" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Risk</SelectItem>{PQR_RISK_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="date" className="w-[140px]" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} aria-label="Filter test date from" />
                <Input type="date" className="w-[140px]" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} aria-label="Filter test date to" />
                <Button variant="outline" size="sm" onClick={resetFilters}>Reset</Button>
                <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => void loadRecords(selectedPqrId, selectedPqr)} disabled={busy}>
                  <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardContent></Card>

            <Tabs defaultValue="summary">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="summary">Stability Summary</TabsTrigger>
                <TabsTrigger value="longterm">Long Term Study</TabsTrigger>
                <TabsTrigger value="accelerated">Accelerated Study</TabsTrigger>
                <TabsTrigger value="intermediate">Intermediate Study</TabsTrigger>
                <TabsTrigger value="pulling">Sample Pulling Review</TabsTrigger>
                <TabsTrigger value="results">Stability Results</TabsTrigger>
                <TabsTrigger value="ootoos">OOT / OOS Review</TabsTrigger>
                <TabsTrigger value="charts">Trend Charts</TabsTrigger>
                <TabsTrigger value="narrative">Narrative</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">{renderTable(filtered, 'No stability records')}</CardContent></Card>
              </TabsContent>
              <TabsContent value="longterm" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">{renderTable(longTermRecords, 'No long term study records')}</CardContent></Card>
              </TabsContent>
              <TabsContent value="accelerated" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">{renderTable(acceleratedRecords, 'No accelerated study records')}</CardContent></Card>
              </TabsContent>
              <TabsContent value="intermediate" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">{renderTable(intermediateRecords, 'No intermediate study records')}</CardContent></Card>
              </TabsContent>
              <TabsContent value="pulling" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">Sample Pulling Review</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">{renderTable(samplePullRecords, 'No sample pulling records')}</CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="results" className="mt-4">
                <Card><CardContent className="pt-6 overflow-x-auto">{renderTable(filtered, 'No stability results')}</CardContent></Card>
              </TabsContent>
              <TabsContent value="ootoos" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">OOT / OOS Review</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">{renderTable(ootOosRecords, 'No OOT/OOS records')}</CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="charts" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card><CardContent className="pt-4">
                    <ParameterTrendChart title="Assay Stability Trend" data={trendToParamChart(charts.assayTrend)} empty={!charts.assayTrend.length} />
                  </CardContent></Card>
                  <Card><CardContent className="pt-4">
                    <ParameterTrendChart title="pH Stability Trend" data={trendToParamChart(charts.phTrend)} empty={!charts.phTrend.length} />
                  </CardContent></Card>
                  <Card><CardContent className="pt-4">
                    <ParameterTrendChart title="Related Substance Trend" data={trendToParamChart(charts.relatedSubstanceTrend)} empty={!charts.relatedSubstanceTrend.length} />
                  </CardContent></Card>
                  <Card><CardContent className="pt-4">
                    <ParameterTrendChart title="Preservative Trend" data={trendToParamChart(charts.preservativeTrend)} empty={!charts.preservativeTrend.length} />
                  </CardContent></Card>
                  <SafeChart title="OOT/OOS Trend" empty={!charts.ootOosTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.ootOosTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                        <Line type="monotone" dataKey="oot" stroke="#d97706" /><Line type="monotone" dataKey="oos" stroke="#dc2626" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Storage Condition-wise Compliance" empty={!charts.storageConditionCompliance.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={charts.storageConditionCompliance}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="condition" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="rate" fill="#2563eb" /></BarChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Interval-wise Compliance" empty={!charts.intervalCompliance.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={charts.intervalCompliance}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="interval" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="rate" fill="#059669" /></BarChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Risk Distribution" empty={!charts.riskDistribution.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={charts.riskDistribution} dataKey="count" nameKey="level" outerRadius={70} label>
                        {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Sample Pulling Compliance" empty={!charts.samplePullingCompliance.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={charts.samplePullingCompliance}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Legend />
                        <Bar dataKey="pulled" fill="#059669" /><Bar dataKey="missed" fill="#dc2626" /><Bar dataKey="due" fill="#d97706" /></BarChart>
                    </ResponsiveContainer>
                  </SafeChart>
                </div>
              </TabsContent>

              <TabsContent value="narrative" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">PQR Section Narrative — Stability Review</CardTitle>
                    {(canManage || canPull) && (
                      <Button size="sm" onClick={() => void handleSaveSection()} disabled={busy || !narrativeDirty}>
                        <Save className="h-4 w-4 mr-1" />Save to PQR
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[140px]"
                      value={narrative}
                      readOnly={!canManage && !canPull}
                      aria-label="Stability review narrative"
                      onChange={(e) => onNarrativeChange(e.target.value)}
                    />
                    {narrativeDirty && <p className="mt-2 text-xs text-amber-700">Unsaved narrative changes</p>}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              {sectionNav.prev ? (
                <Button variant="outline" asChild>
                  <Link href={sectionNav.prev.href}><ChevronLeft className="h-4 w-4 mr-1" />{sectionNav.prev.label}</Link>
                </Button>
              ) : <span />}
              <div className="flex flex-wrap gap-2 text-xs">
                <Link className="text-blue-600 hover:underline" href="/cpv/stability-monitoring">Stability Monitoring</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/dashboard', selectedPqrId)}>PQR Dashboard</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/oos">OOS</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/deviation">Deviations</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/capa">CAPA</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/change-control">Change Control</Link>
              </div>
              {sectionNav.next ? (
                <Button variant="outline" asChild>
                  <Link href={sectionNav.next.href}>{sectionNav.next.label}<ChevronRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              ) : <span />}
            </div>
          </>
        )}

        {selectedPqr && (
          <StabilityReviewFormDialog open={formOpen} onOpenChange={setFormOpen} pqr={selectedPqr} record={editRecord} onSubmit={handleSaveForm} loading={busy} />
        )}

        <Dialog open={!!detailRecord} onOpenChange={() => setDetailRecord(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{detailRecord?.batchNumber} — {detailRecord?.parameterName}</DialogTitle></DialogHeader>
            {detailRecord && (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ['Study', `${detailRecord.studyNumber || '—'} (${detailRecord.studyType})`],
                    ['Protocol Number', detailRecord.protocolNumber || '—'],
                    ['Specification Version', detailRecord.specificationVersion || '—'],
                    ['Chamber ID', detailRecord.chamberId || '—'],
                    ['Storage / Interval', `${detailRecord.storageCondition} / ${detailRecord.pullingInterval}`],
                    ['Observed Result', `${detailRecord.observedResult} ${detailRecord.unit}`],
                    ['Specification', `${detailRecord.lowerLimit} – ${detailRecord.upperLimit}`],
                    ['Test Date', detailRecord.testDate],
                    ['Sample Pull', `${detailRecord.samplePullingDueDate || '—'} → ${detailRecord.actualPullingDate || '—'} (${detailRecord.samplePullStatus})`],
                    ['OOT / OOS / CAPA', `${detailRecord.ootCount} / ${detailRecord.oosCount} / ${detailRecord.capaCount}`],
                    ['Deviations / Change Controls', `${detailRecord.deviationCount ?? 0} / ${detailRecord.changeControlCount ?? 0}`],
                    ['Shelf Life Impact', detailRecord.impactOnShelfLife],
                    ['Quality Impact', detailRecord.impactOnProductQuality],
                    ['Conclusion', detailRecord.conclusion],
                  ].map(([k, v]) => (
                    <div key={String(k)}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{String(v)}</dd></div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <ResultStatusBadge status={detailRecord.resultStatus} />
                  <ComplianceBadge status={detailRecord.complianceStatus} />
                  <RiskBadge level={detailRecord.riskLevel} />
                </div>
                {(detailRecord.complianceReasons || []).length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {detailRecord.complianceReasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
                {(detailRecord.attachmentUrls || []).length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {(detailRecord.attachmentUrls || []).map((url) => (
                      <li key={url} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                        <a href={url} target="_blank" rel="noreferrer" className="truncate text-blue-600 hover:underline">
                          {url.split('/').pop()?.split('?')[0] || 'Attachment'}
                        </a>
                        {canManage && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label="Remove attachment"
                            onClick={() => {
                              if (!detailRecord.id || !selectedPqr) return;
                              void deleteStabilityReviewAttachment(selectedPqr.id, detailRecord.id, url, actor).then(({ error: err }) => {
                                if (err) toast.error(err);
                                else {
                                  toast.success('Attachment removed');
                                  void loadRecords(selectedPqr.id, selectedPqr);
                                  setDetailRecord({
                                    ...detailRecord,
                                    attachmentUrls: (detailRecord.attachmentUrls || []).filter((u) => u !== url),
                                  });
                                }
                              });
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {detailRecord.id && selectedPqr && (
                  <AttachmentUploader
                    onUpload={async (file) => {
                      const { url, error: err } = await uploadStabilityReviewAttachment(selectedPqr.id, detailRecord.id!, file, actor);
                      if (err) return { error: err };
                      await loadRecords(selectedPqr.id, selectedPqr);
                      if (url) {
                        setDetailRecord({
                          ...detailRecord,
                          attachmentUrls: [...(detailRecord.attachmentUrls || []), url],
                        });
                      }
                      return {};
                    }}
                    disabled={!canManage}
                  />
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Stability Record"
          description="This will soft-delete the stability review record." confirmLabel="Remove" destructive loading={busy} onConfirm={handleDelete} />
      </div>
    </StabilityReviewAccessGuard>
  );
}
