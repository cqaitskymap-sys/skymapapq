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
  PQR_COMPLIANCE_STATUSES, PQR_REVIEW_TYPES, PQR_RISK_LEVELS,
  canAddUtilityEnvReview, canExportUtilityEnvReview, canManageUtilityEnvReview,
  computeUtilityEnvSummary, filterUtilityEnvReviewRecords,
  type PqrUtilityEnvironmentalReviewRecord, type UtilityEnvReviewFormData,
} from '@/lib/pqr-utility-environmental-review-records';
import {
  buildUtilityEnvCharts, createUtilityEnvReviewRecord, exportUtilityEnvReviewCsv,
  fetchUtilityEnvQualityMetrics, fetchUtilityEnvReviewRecords,
  fetchPqrOptions, getUtilityEnvReviewNarrative, logUtilityEnvNarrativeEdit,
  logUtilityEnvReviewExport, logUtilityEnvReviewView, pullUtilityEnvironmentalData,
  recalculateAllUtilityEnvCompliance, saveUtilityEnvSectionToPqr,
  softDeleteUtilityEnvReviewRecord, updateUtilityEnvReviewRecord,
} from '@/lib/pqr-utility-environmental-review-service';
import { UTILITY_TYPES } from '@/lib/cpv-utility-monitoring';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { UtilityEnvReviewAccessGuard } from './utility-env-review-access-guard';
import { UtilityEnvReviewFormDialog } from './utility-env-review-form-dialog';
import { ComplianceBadge, ExcursionBadge, GradeBadge, RiskBadge } from './utility-env-review-badges';
import { ParameterTrendChart } from './parameter-trend-chart';
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
const WFI_TYPES = ['Water for Injection', 'Purified Water'];
const AIR_TYPES = ['Compressed Air', 'Nitrogen'];

function SafeChart({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-52">{empty ? <EmptyState title="No data" message="No chart data." /> : children}</CardContent>
    </Card>
  );
}

type TableRow = PqrUtilityEnvironmentalReviewRecord & { srNo: number };

export function UtilityEnvironmentalReviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canManage = canManageUtilityEnvReview(role);
  const canAdd = canAddUtilityEnvReview(role);
  const canExport = canExportUtilityEnvReview(role);

  const [pqrs, setPqrs] = useState<PqrOption[]>([]);
  const [selectedPqrId, setSelectedPqrId] = useState('');
  const [records, setRecords] = useState<PqrUtilityEnvironmentalReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState('');
  const [narrativeDirty, setNarrativeDirty] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<PqrUtilityEnvironmentalReviewRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<PqrUtilityEnvironmentalReviewRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [filterReviewType, setFilterReviewType] = useState('all');
  const [filterUtilityType, setFilterUtilityType] = useState('all');
  const [filterCompliance, setFilterCompliance] = useState('all');
  const [filterRisk, setFilterRisk] = useState('all');
  const [filterArea, setFilterArea] = useState('');
  const [filterParameter, setFilterParameter] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [qualityMetrics, setQualityMetrics] = useState({
    utilityEnvDeviations: 0, utilityEnvOos: 0, utilityEnvCapa: 0, utilityEnvChangeControls: 0,
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
    router.replace(`/pqr/utility-review?${params.toString()}`, { scroll: false });
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
      const rows = await fetchUtilityEnvReviewRecords(pqrId);
      setRecords(rows);
      setNarrative(getUtilityEnvReviewNarrative(rows));
      setNarrativeDirty(false);
      if (pqr) {
        const metrics = await fetchUtilityEnvQualityMetrics(pqr, rows);
        setQualityMetrics(metrics);
      }
    } catch { toast.error('Failed to load review records'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadPqrs(); void logUtilityEnvReviewView(actor); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedPqrId) {
      void loadRecords(selectedPqrId, selectedPqr);
      syncPqrIdToUrl(selectedPqrId);
    }
  }, [selectedPqrId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (narrativeAuditTimer.current) clearTimeout(narrativeAuditTimer.current);
  }, []);

  const filtered = useMemo(() => filterUtilityEnvReviewRecords(records, {
    reviewType: filterReviewType,
    utilityType: filterUtilityType,
    complianceStatus: filterCompliance,
    riskLevel: filterRisk,
    system: filterArea,
    parameter: filterParameter,
    search: filterSearch,
  }), [records, filterReviewType, filterUtilityType, filterCompliance, filterRisk, filterArea, filterParameter, filterSearch]);

  const utilityRecords = useMemo(() => filtered.filter((r) => r.reviewType === 'Utility Review'), [filtered]);
  const envRecords = useMemo(() => filtered.filter((r) => r.reviewType === 'Environmental Review'), [filtered]);
  const wfiRecords = useMemo(() => utilityRecords.filter((r) => WFI_TYPES.includes(r.utilityType)), [utilityRecords]);
  const airRecords = useMemo(() => utilityRecords.filter((r) => AIR_TYPES.includes(r.utilityType)), [utilityRecords]);
  const hvacRecords = useMemo(() => utilityRecords.filter((r) => r.utilityType === 'HVAC'), [utilityRecords]);
  const excursionRecords = useMemo(() => filtered.filter((r) => r.excursionCount > 0), [filtered]);
  const summary = useMemo(() => computeUtilityEnvSummary(filtered), [filtered]);
  const charts = useMemo(() => buildUtilityEnvCharts(filtered), [filtered]);

  const sectionNav = useMemo(() => {
    const idx = PQR_SECTION_FLOW.findIndex((s) => s.key === 'utility');
    const prev = PQR_SECTION_FLOW[idx - 1];
    const next = PQR_SECTION_FLOW[idx + 1];
    return {
      prev: prev ? { ...prev, href: pqrSectionHref(prev.href, selectedPqrId) } : null,
      next: next ? { ...next, href: pqrSectionHref(next.href, selectedPqrId) } : null,
    };
  }, [selectedPqrId]);

  const resetFilters = () => {
    setFilterReviewType('all');
    setFilterUtilityType('all');
    setFilterCompliance('all');
    setFilterRisk('all');
    setFilterArea('');
    setFilterParameter('');
    setFilterSearch('');
  };

  const tableColumns: ColumnDef<TableRow>[] = [
    { key: 'srNo', header: 'Sr. No.' },
    { key: 'systemAreaName', header: 'System / Area' },
    { key: 'reviewType', header: 'Review Type', render: (r) => <span className="text-xs">{r.reviewType.replace(' Review', '')}</span> },
    { key: 'monitoringParameter', header: 'Parameter' },
    { key: 'observedMinimum', header: 'Min', render: (r) => r.observedMinimum ?? '—' },
    { key: 'observedMaximum', header: 'Max', render: (r) => r.observedMaximum ?? '—' },
    { key: 'observedAverage', header: 'Avg', render: (r) => r.observedAverage ?? '—' },
    { key: 'limits', header: 'Limit', render: (r) => `${r.lowerLimit}–${r.upperLimit}` },
    { key: 'excursionCount', header: 'Excursions', render: (r) => <ExcursionBadge count={r.excursionCount} /> },
    { key: 'deviationCount', header: 'Deviations' },
    { key: 'capaCount', header: 'CAPA' },
    { key: 'complianceStatus', header: 'Compliance', render: (r) => <ComplianceBadge status={r.complianceStatus} /> },
    { key: 'remarks', header: 'Remarks', render: (r) => <span className="line-clamp-1 max-w-[70px]">{r.remarks || '—'}</span> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`View ${r.systemAreaName}`} onClick={() => setDetailRecord(r)}><Eye className="h-4 w-4" /></Button>
          {canManage && (
            <>
              <Button variant="ghost" size="icon" aria-label={`Edit ${r.systemAreaName}`} onClick={() => { setEditRecord(r); setFormOpen(true); }}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${r.systemAreaName}`} onClick={() => setDeleteId(r.id || null)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const toTable = (rows: PqrUtilityEnvironmentalReviewRecord[]): TableRow[] => rows.map((r, i) => ({ ...r, srNo: i + 1 }));
  const renderTable = (rows: PqrUtilityEnvironmentalReviewRecord[], emptyTitle: string) => (
    rows.length ? (
      <ResponsiveDataTable columns={tableColumns} data={toTable(rows)} searchKeys={['systemAreaName', 'monitoringParameter']} mobileTitleKey="systemAreaName" mobileSubtitleKey="monitoringParameter" pageSize={15} />
    ) : <EmptyState title={emptyTitle} message="Pull monitoring data or add manually." />
  );

  const handlePull = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { created, skipped, error: err } = await pullUtilityEnvironmentalData(selectedPqr, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`${created} review record(s) created (${skipped} skipped)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveForm = async (data: UtilityEnvReviewFormData): Promise<void> => {
    if (!selectedPqr) return;
    setBusy(true);
    const result = editRecord?.id
      ? await updateUtilityEnvReviewRecord(editRecord.id, data, actor)
      : await createUtilityEnvReviewRecord(selectedPqr, data, actor);
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
    const { error: err } = await saveUtilityEnvSectionToPqr(selectedPqr.id, narrative, records, actor);
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
    const { updated, error: err } = await recalculateAllUtilityEnvCompliance(selectedPqr.id, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`Compliance recalculated for ${updated} record(s)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteId || !selectedPqr) return;
    setBusy(true);
    const { error: err } = await softDeleteUtilityEnvReviewRecord(deleteId, actor);
    setBusy(false);
    setDeleteId(null);
    if (err) { toast.error(err); return; }
    toast.success('Record removed');
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('No records to export');
    exportUtilityEnvReviewCsv(filtered, selectedPqr?.pqrNumber);
    void logUtilityEnvReviewExport(actor, 'csv');
    toast.success('Utility & environmental review exported as CSV');
  };

  const onNarrativeChange = (value: string) => {
    setNarrative(value);
    setNarrativeDirty(true);
    if (!selectedPqr) return;
    if (narrativeAuditTimer.current) clearTimeout(narrativeAuditTimer.current);
    narrativeAuditTimer.current = setTimeout(() => {
      void logUtilityEnvNarrativeEdit(actor, selectedPqr.id);
    }, 1500);
  };

  if (loading) return <UtilityEnvReviewAccessGuard><div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div></UtilityEnvReviewAccessGuard>;
  if (error) return <UtilityEnvReviewAccessGuard><div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void loadPqrs()} /></div></UtilityEnvReviewAccessGuard>;

  return (
    <UtilityEnvReviewAccessGuard>
      <div className="space-y-6 p-4 sm:p-6">
        <CpvPageHeader
          title="Utility & Environmental Review"
          description="Review utility performance and cleanroom environmental monitoring during the PQR period"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'Utility & Environmental Review' },
          ]}
          actions={(
            <>
              {canExport && (
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" />Export CSV
                </Button>
              )}
              {canManage && selectedPqr && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handlePull()} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    Pull Data
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleRecalc()} disabled={busy}>Recalc</Button>
                </>
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
              className={`rounded-md border px-2.5 py-1 ${s.key === 'utility' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50'}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <Card><CardContent className="pt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pqr-select-utility">PQR Number *</Label>
              <Select
                value={selectedPqrId}
                onValueChange={(id) => {
                  setSelectedPqrId(id);
                  syncPqrIdToUrl(id);
                }}
              >
                <SelectTrigger id="pqr-select-utility"><SelectValue placeholder="Select PQR..." /></SelectTrigger>
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
          <EmptyState title="Select a PQR" message="Choose a PQR to review utility and environmental monitoring data." />
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-12">
              <KpiCard label="Utility Records" value={summary.totalUtilityRecords} />
              <KpiCard label="Environmental" value={summary.totalEnvironmentalRecords} />
              <KpiCard label="Compliant" value={summary.compliantRecords} tone="green" />
              <KpiCard label="Alerts" value={summary.alertRecords} tone="amber" />
              <KpiCard label="Actions" value={summary.actionRecords} tone="amber" />
              <KpiCard label="Excursions" value={summary.excursionRecords} tone="red" />
              <KpiCard label="Grade A/B Exc." value={summary.gradeAExcursions} tone="red" />
              <KpiCard label="WFI Excursions" value={summary.wfiExcursions} tone="red" />
              <KpiCard label="Deviations" value={qualityMetrics.utilityEnvDeviations || summary.deviationCount} />
              <KpiCard label="OOS / CAPA" value={`${qualityMetrics.utilityEnvOos || summary.oosCount}/${qualityMetrics.utilityEnvCapa || summary.capaCount}`} />
              <KpiCard label="Change Controls" value={qualityMetrics.utilityEnvChangeControls || summary.changeControlCount} />
              <KpiCard label="Critical Risks" value={summary.openCriticalRisks} tone="red" />
            </div>

            <Card><CardContent className="pt-6">
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Search system / parameter"
                  className="w-full sm:w-[200px]"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  aria-label="Search utility and environmental records"
                />
                <Select value={filterReviewType} onValueChange={setFilterReviewType}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter review type"><SelectValue placeholder="Review Type" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Types</SelectItem>{PQR_REVIEW_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterUtilityType} onValueChange={setFilterUtilityType}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter utility type"><SelectValue placeholder="Utility Type" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All Utilities</SelectItem>{UTILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={filterCompliance} onValueChange={setFilterCompliance}>
                  <SelectTrigger className="w-[160px]" aria-label="Filter compliance"><SelectValue placeholder="Compliance" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Compliance</SelectItem>
                    {PQR_COMPLIANCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filterRisk} onValueChange={setFilterRisk}>
                  <SelectTrigger className="w-[120px]" aria-label="Filter risk"><SelectValue placeholder="Risk" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Risk</SelectItem>
                    {PQR_RISK_LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Area / system" className="w-[140px]" value={filterArea} onChange={(e) => setFilterArea(e.target.value)} aria-label="Filter area or system" />
                <Input placeholder="Parameter" className="w-[130px]" value={filterParameter} onChange={(e) => setFilterParameter(e.target.value)} aria-label="Filter parameter" />
                <Button variant="outline" size="sm" onClick={resetFilters}>Reset</Button>
                <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => void loadRecords(selectedPqrId, selectedPqr)} disabled={busy}>
                  <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </CardContent></Card>

            <Tabs defaultValue="utility">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="utility">Utility Summary</TabsTrigger>
                <TabsTrigger value="environmental">Environmental Summary</TabsTrigger>
                <TabsTrigger value="wfi">WFI / PW</TabsTrigger>
                <TabsTrigger value="air">Compressed Air / N2</TabsTrigger>
                <TabsTrigger value="hvac">HVAC</TabsTrigger>
                <TabsTrigger value="cleanroom">Cleanroom</TabsTrigger>
                <TabsTrigger value="excursion">Excursions</TabsTrigger>
                <TabsTrigger value="devcap">Deviation / CAPA</TabsTrigger>
                <TabsTrigger value="charts">Trend Charts</TabsTrigger>
                <TabsTrigger value="narrative">Narrative</TabsTrigger>
              </TabsList>

              <TabsContent value="utility" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(utilityRecords, 'No utility records')}</CardContent></Card></TabsContent>
              <TabsContent value="environmental" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(envRecords, 'No environmental records')}</CardContent></Card></TabsContent>
              <TabsContent value="wfi" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(wfiRecords, 'No WFI/PW records')}</CardContent></Card></TabsContent>
              <TabsContent value="air" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(airRecords, 'No compressed air/nitrogen records')}</CardContent></Card></TabsContent>
              <TabsContent value="hvac" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(hvacRecords, 'No HVAC records')}</CardContent></Card></TabsContent>
              <TabsContent value="cleanroom" className="mt-4"><Card><CardContent className="pt-6 overflow-x-auto">{renderTable(envRecords, 'No cleanroom monitoring records')}</CardContent></Card></TabsContent>

              <TabsContent value="excursion" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">Excursion Review</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {excursionRecords.map((r) => (
                      <p key={r.id}>{r.systemAreaName} — {r.monitoringParameter}: {r.excursionCount} excursion(s), {r.deviationCount} deviation(s) — Impact: {r.impactOnProductQuality} <GradeBadge grade={r.cleanroomGrade} /></p>
                    ))}
                    {!excursionRecords.length && <p className="text-muted-foreground">No excursions recorded.</p>}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="devcap" className="mt-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <Card><CardHeader><CardTitle className="text-sm">Linked Deviations</CardTitle></CardHeader>
                    <CardContent>{qualityMetrics.utilityEnvDeviations || summary.deviationCount} total
                      <div className="mt-2"><Link className="text-xs text-blue-600 hover:underline" href="/qms/deviation">Open Deviations</Link></div>
                    </CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-sm">Linked OOS</CardTitle></CardHeader>
                    <CardContent>{qualityMetrics.utilityEnvOos || summary.oosCount} total
                      <div className="mt-2"><Link className="text-xs text-blue-600 hover:underline" href="/qms/oos">Open OOS</Link></div>
                    </CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-sm">Linked CAPA</CardTitle></CardHeader>
                    <CardContent>{qualityMetrics.utilityEnvCapa || summary.capaCount} total
                      <div className="mt-2"><Link className="text-xs text-blue-600 hover:underline" href="/qms/capa">Open CAPA</Link></div>
                    </CardContent></Card>
                </div>
              </TabsContent>

              <TabsContent value="charts" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <SafeChart title="Utility Compliance Trend" empty={!charts.utilityComplianceTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.utilityComplianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                        <Line type="monotone" dataKey="compliant" stroke="#059669" /><Line type="monotone" dataKey="nonCompliant" stroke="#dc2626" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Environmental Compliance Trend" empty={!charts.environmentalComplianceTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.environmentalComplianceTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                        <Line type="monotone" dataKey="compliant" stroke="#059669" /><Line type="monotone" dataKey="nonCompliant" stroke="#dc2626" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <Card><CardContent className="pt-4"><ParameterTrendChart title="Temperature Trend" data={charts.temperatureTrend} empty={!charts.temperatureTrend.length} /></CardContent></Card>
                  <Card><CardContent className="pt-4"><ParameterTrendChart title="RH Trend" data={charts.rhTrend} empty={!charts.rhTrend.length} /></CardContent></Card>
                  <Card><CardContent className="pt-4"><ParameterTrendChart title="Differential Pressure" data={charts.differentialPressureTrend} empty={!charts.differentialPressureTrend.length} /></CardContent></Card>
                  <Card><CardContent className="pt-4"><ParameterTrendChart title="WFI Conductivity" data={charts.wfiConductivityTrend} empty={!charts.wfiConductivityTrend.length} /></CardContent></Card>
                  <SafeChart title="Excursion Trend" empty={!charts.excursionTrend.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={charts.excursionTrend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Line type="monotone" dataKey="count" stroke="#d97706" /></LineChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Area-wise Excursions" empty={!charts.areaExcursionDistribution.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={charts.areaExcursionDistribution}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="area" tick={{ fontSize: 9 }} /><YAxis /><Tooltip /><Bar dataKey="count" fill="#dc2626" /></BarChart>
                    </ResponsiveContainer>
                  </SafeChart>
                  <SafeChart title="Risk Distribution" empty={!charts.riskDistribution.length}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart><Pie data={charts.riskDistribution} dataKey="value" nameKey="name" outerRadius={70} label>
                        {charts.riskDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie><Tooltip /></PieChart>
                    </ResponsiveContainer>
                  </SafeChart>
                </div>
              </TabsContent>

              <TabsContent value="narrative" className="mt-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">PQR Section Narrative</CardTitle>
                    {canManage && (
                      <Button size="sm" onClick={() => void handleSaveSection()} disabled={busy || !narrativeDirty}>
                        <Save className="h-4 w-4 mr-1" />Save to PQR
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[140px]"
                      value={narrative}
                      readOnly={!canManage}
                      aria-label="Utility and environmental review narrative"
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
                <Link className="text-blue-600 hover:underline" href="/cpv/utility-monitoring">Utility Monitoring</Link>
                <Link className="text-blue-600 hover:underline" href="/cpv/environmental-monitoring">Environmental Monitoring</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/dashboard', selectedPqrId)}>PQR Dashboard</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/equipment/calibration-records">Calibration</Link>
                <Link className="text-blue-600 hover:underline" href="/qms/deviation">Deviations</Link>
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
          <UtilityEnvReviewFormDialog open={formOpen} onOpenChange={setFormOpen} pqr={selectedPqr} record={editRecord} onSubmit={handleSaveForm} loading={busy} />
        )}

        <Dialog open={!!detailRecord} onOpenChange={() => setDetailRecord(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{detailRecord?.systemAreaName}</DialogTitle></DialogHeader>
            {detailRecord && (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ['Review Type', detailRecord.reviewType],
                    ['Parameter', detailRecord.monitoringParameter],
                    ['Utility Type', detailRecord.utilityType],
                    ['Room', detailRecord.roomNumber || '—'],
                    ['Unit', detailRecord.unit || '—'],
                    ['Sample Count', detailRecord.sampleCount ?? '—'],
                    ['Std Deviation', detailRecord.stdDeviation ?? '—'],
                    ['Min / Max / Avg', `${detailRecord.observedMinimum ?? '—'} / ${detailRecord.observedMaximum ?? '—'} / ${detailRecord.observedAverage ?? '—'}`],
                    ['Limits', `${detailRecord.lowerLimit} – ${detailRecord.upperLimit}`],
                    ['Alerts / Actions / Excursions', `${detailRecord.alertCount} / ${detailRecord.actionCount} / ${detailRecord.excursionCount}`],
                    ['Deviations / OOS / CAPA / CC', `${detailRecord.deviationCount} / ${detailRecord.oosCount ?? 0} / ${detailRecord.capaCount} / ${detailRecord.changeControlCount}`],
                    ['Batches', (detailRecord.batchNumbers || []).join(', ') || '—'],
                    ['Product Impact', detailRecord.impactOnProductQuality],
                    ['Conclusion', detailRecord.conclusion || '—'],
                    ['Criticality', detailRecord.criticality || '—'],
                  ].map(([k, v]) => (
                    <div key={String(k)}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{String(v)}</dd></div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <ComplianceBadge status={detailRecord.complianceStatus} />
                  <RiskBadge level={detailRecord.riskLevel} />
                  <GradeBadge grade={detailRecord.cleanroomGrade} />
                  <ExcursionBadge count={detailRecord.excursionCount} />
                </div>
                {(detailRecord.complianceReasons || []).length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {detailRecord.complianceReasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)} title="Remove Review Record"
          description="This will soft-delete the utility/environmental review record." confirmLabel="Remove" destructive loading={busy} onConfirm={handleDelete} />
      </div>
    </UtilityEnvReviewAccessGuard>
  );
}
