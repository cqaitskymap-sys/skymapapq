'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive, CheckCircle, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, RefreshCw, Save, Send, XCircle,
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
import type { ConsolidatedReviewData, PqrSummaryConclusionRecord } from '@/lib/pqr-summary-conclusion-records';
import {
  canApproveSummaryConclusion,
  canExportSummaryConclusion,
  canManageSummaryConclusion,
  formatCompliancePct,
  summaryApprovalSchema,
  type SummaryApprovalFormData,
} from '@/lib/pqr-summary-conclusion-records';
import {
  approveSummaryConclusion,
  archiveSummaryConclusion,
  buildApprovalReadiness,
  buildSectionCompletion,
  buildSummaryCharts,
  buildSummaryFindings,
  consolidatePqrReviewData,
  exportSummaryConclusionCsv,
  fetchPqrOptions,
  fetchSummaryConclusionRecord,
  generateSummaryConclusion,
  logSummaryConclusionView,
  logSummaryExportCsv,
  logSummaryNarrativeEdit,
  normalizeSummaryMetrics,
  rejectSummaryConclusion,
  submitSummaryForReview,
  updateSummaryConclusionFields,
} from '@/lib/pqr-summary-conclusion-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { SummaryConclusionAccessGuard } from './summary-conclusion-access-guard';
import { ProcessStatusBadge, QualityStatusBadge, RiskBadge, SummaryStatusBadge } from './summary-conclusion-badges';
import { QualityScoreGauge } from './quality-score-gauge';
import { ApprovalTimeline } from './approval-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#64748b'];

const NARRATIVE_FIELDS: Array<{ key: keyof PqrSummaryConclusionRecord; label: string }> = [
  { key: 'executiveSummary', label: 'Executive Summary' },
  { key: 'qualityPerformanceSummary', label: 'Quality Performance Summary' },
  { key: 'manufacturingPerformanceSummary', label: 'Manufacturing Performance Summary' },
  { key: 'materialPerformanceSummary', label: 'Material Performance Summary' },
  { key: 'packagingPerformanceSummary', label: 'Packaging Performance Summary' },
  { key: 'equipmentPerformanceSummary', label: 'Equipment Performance Summary' },
  { key: 'utilityPerformanceSummary', label: 'Utility Performance Summary' },
  { key: 'environmentalPerformanceSummary', label: 'Environmental Performance Summary' },
  { key: 'stabilityPerformanceSummary', label: 'Stability Performance Summary' },
  { key: 'deviationSummary', label: 'Deviation Summary' },
  { key: 'oosSummary', label: 'OOS Summary' },
  { key: 'capaSummary', label: 'CAPA Summary' },
  { key: 'riskAssessmentSummary', label: 'Risk Assessment Summary' },
  { key: 'trendAnalysisSummary', label: 'Trend Analysis Summary' },
  { key: 'cpvSummary', label: 'CPV Summary' },
];

function SafeChart({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-52">{empty ? <EmptyState title="No data" message="No chart data." /> : children}</CardContent>
    </Card>
  );
}

export function SummaryConclusionPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canManage = canManageSummaryConclusion(role);
  const canApprove = canApproveSummaryConclusion(role);
  const canExport = canExportSummaryConclusion(role);

  const [pqrs, setPqrs] = useState<PqrOption[]>([]);
  const [selectedPqrId, setSelectedPqrId] = useState('');
  const [record, setRecord] = useState<PqrSummaryConclusionRecord | null>(null);
  const [consolidated, setConsolidated] = useState<ConsolidatedReviewData | null>(null);
  const [charts, setCharts] = useState<ReturnType<typeof buildSummaryCharts> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComments, setRejectComments] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignPassword, setEsignPassword] = useState('');
  const [esignReason, setEsignReason] = useState('');

  const [form, setForm] = useState<SummaryApprovalFormData>({
    executiveSummary: '',
    finalConclusion: '',
    recommendations: '',
    reviewedBy: '',
    approvedBy: '',
    reviewerComments: '',
    qaComments: '',
    headQaComments: '',
    finalApprovalComments: '',
  });

  const narrativeAuditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
    email: user?.email || profile?.email,
  }), [user?.uid, user?.email, profile?.full_name, profile?.email, role]);

  const selectedPqr = useMemo(() => pqrs.find((p) => p.id === selectedPqrId) || null, [pqrs, selectedPqrId]);
  const metrics = useMemo(() => normalizeSummaryMetrics(record?.metrics), [record?.metrics]);
  const locked = record?.status === 'Approved' || record?.status === 'Archived';

  const utilTotal = useMemo(
    () => (consolidated?.utilityEnv || []).filter((r) => !r.isDeleted && r.reviewType === 'Utility Review').length,
    [consolidated],
  );
  const envTotal = useMemo(
    () => (consolidated?.utilityEnv || []).filter((r) => !r.isDeleted && r.reviewType === 'Environmental Review').length,
    [consolidated],
  );

  const sectionCompletion = useMemo(
    () => (consolidated ? buildSectionCompletion(consolidated) : []),
    [consolidated],
  );
  const findings = useMemo(
    () => (consolidated ? buildSummaryFindings(consolidated, metrics) : []),
    [consolidated, metrics],
  );
  const readiness = useMemo(
    () => (consolidated ? buildApprovalReadiness(consolidated, record) : { ready: false, items: [] }),
    [consolidated, record],
  );

  const sectionNav = useMemo(() => {
    const idx = PQR_SECTION_FLOW.findIndex((s) => s.key === 'summary');
    const prev = PQR_SECTION_FLOW[idx - 1];
    const next = PQR_SECTION_FLOW[idx + 1];
    return {
      prev: prev ? { ...prev, href: pqrSectionHref(prev.href, selectedPqrId) } : null,
      next: next ? { ...next, href: pqrSectionHref(next.href, selectedPqrId) } : null,
    };
  }, [selectedPqrId]);

  const syncPqrIdToUrl = useCallback((pqrId: string) => {
    if (!pqrId) return;
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (params.get('pqrId') === pqrId) return;
    params.set('pqrId', pqrId);
    const base = pathname || '/pqr/summary';
    router.replace(`${base}?${params.toString()}`, { scroll: false });
  }, [router, searchParams, pathname]);

  const applyFormFromRecord = (rec: PqrSummaryConclusionRecord) => {
    setForm({
      executiveSummary: rec.executiveSummary,
      finalConclusion: rec.finalConclusion,
      recommendations: rec.recommendations,
      reviewedBy: rec.reviewedBy,
      approvedBy: rec.approvedBy,
      reviewerComments: rec.reviewerComments,
      qaComments: rec.qaComments,
      headQaComments: rec.headQaComments,
      finalApprovalComments: rec.finalApprovalComments,
    });
  };

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

  const loadRecord = useCallback(async (pqr: PqrOption) => {
    setBusy(true);
    try {
      const [rec, data] = await Promise.all([
        fetchSummaryConclusionRecord(pqr.id),
        consolidatePqrReviewData(pqr),
      ]);
      setConsolidated(data);
      setRecord(rec);
      if (rec) {
        applyFormFromRecord(rec);
        setCharts(buildSummaryCharts(data, normalizeSummaryMetrics(rec.metrics)));
      } else {
        setCharts(null);
      }
    } catch { toast.error('Failed to load summary record'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void loadPqrs(); void logSummaryConclusionView(actor); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedPqr) {
      void loadRecord(selectedPqr);
      syncPqrIdToUrl(selectedPqr.id);
    }
  }, [selectedPqrId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (narrativeAuditTimer.current) clearTimeout(narrativeAuditTimer.current);
  }, []);

  const handleGenerate = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { record: rec, error: err } = await generateSummaryConclusion(selectedPqr, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success('Summary & conclusion generated');
    if (rec) {
      setRecord(rec);
      applyFormFromRecord(rec);
      const data = await consolidatePqrReviewData(selectedPqr);
      setConsolidated(data);
      setCharts(buildSummaryCharts(data, normalizeSummaryMetrics(rec.metrics)));
    }
  };

  const handleSaveFields = async (fields: Partial<PqrSummaryConclusionRecord>) => {
    if (!record?.id || !selectedPqr) return;
    setBusy(true);
    const { error: err } = await updateSummaryConclusionFields(record.id, fields, actor, selectedPqr.id);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success('Saved');
    await loadRecord(selectedPqr);
  };

  const handleSubmitReview = async () => {
    if (!record?.id || !selectedPqr) return;
    const parsed = summaryApprovalSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.errors[0]?.message || 'Validation failed');
    setBusy(true);
    const { error: err } = await submitSummaryForReview(record.id, parsed.data, actor, selectedPqr);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success('Submitted for review');
    await loadRecord(selectedPqr);
  };

  const handleApprove = async () => {
    if (!record?.id || !selectedPqrId) return;
    const parsed = summaryApprovalSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.errors[0]?.message || 'Validation failed');
    if (!esignPassword || esignPassword.length < 6) return toast.error('Enter password for e-signature (min 6 characters)');
    if (!esignReason.trim()) return toast.error('Reason for signature is required');
    setBusy(true);
    const { error: err } = await approveSummaryConclusion(
      record.id,
      parsed.data,
      actor,
      { meaning: 'Approved By', reason: esignReason.trim(), password: esignPassword },
      selectedPqrId,
    );
    setBusy(false);
    setEsignOpen(false);
    setEsignPassword('');
    setEsignReason('');
    if (err) return toast.error(err);
    toast.success('PQR summary approved');
    if (selectedPqr) await loadRecord(selectedPqr);
  };

  const handleReject = async () => {
    if (!record?.id || !selectedPqrId) return;
    if (!rejectComments.trim()) return toast.error('Rejection comments are required');
    setBusy(true);
    const { error: err } = await rejectSummaryConclusion(record.id, rejectComments.trim(), actor, selectedPqrId);
    setBusy(false);
    setRejectOpen(false);
    setRejectComments('');
    if (err) { toast.error(err); return; }
    toast.success('Summary rejected');
    if (selectedPqr) await loadRecord(selectedPqr);
  };

  const handleArchive = async () => {
    if (!record?.id || !selectedPqrId) return;
    setBusy(true);
    const { error: err } = await archiveSummaryConclusion(record.id, actor, selectedPqrId);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success('Summary archived');
    if (selectedPqr) await loadRecord(selectedPqr);
  };

  const handleExportCsv = () => {
    if (!record || !consolidated) return toast.info('Generate summary before exporting');
    exportSummaryConclusionCsv(record, consolidated);
    void logSummaryExportCsv(actor);
    toast.success('Summary exported as CSV');
  };

  const updateNarrative = (key: keyof PqrSummaryConclusionRecord, value: string) => {
    setRecord((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (key === 'executiveSummary') setForm((f) => ({ ...f, executiveSummary: value }));
    if (key === 'finalConclusion') setForm((f) => ({ ...f, finalConclusion: value }));
    if (key === 'recommendations') setForm((f) => ({ ...f, recommendations: value }));
    if (!selectedPqr) return;
    if (narrativeAuditTimer.current) clearTimeout(narrativeAuditTimer.current);
    narrativeAuditTimer.current = setTimeout(() => {
      void logSummaryNarrativeEdit(actor, selectedPqr.id);
    }, 800);
  };

  if (loading) {
    return (
      <SummaryConclusionAccessGuard>
        <div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div>
      </SummaryConclusionAccessGuard>
    );
  }
  if (error) {
    return (
      <SummaryConclusionAccessGuard>
        <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void loadPqrs()} /></div>
      </SummaryConclusionAccessGuard>
    );
  }

  return (
    <SummaryConclusionAccessGuard>
      <div className="space-y-6 p-4 sm:p-6">
        <CpvPageHeader
          title="PQR Summary & Conclusion"
          description="Final Product Quality Review Assessment and Management Conclusion"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'Summary & Conclusion' },
          ]}
          actions={(
            <>
              {canExport && (
                <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!record || !consolidated}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" />Export CSV
                </Button>
              )}
              {canManage && selectedPqr && (
                <Button size="sm" onClick={() => void handleGenerate()} disabled={busy || locked}>
                  {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  Generate Summary
                </Button>
              )}
            </>
          )}
        />

        <div className="flex flex-wrap gap-2 text-sm">
          {PQR_SECTION_FLOW.filter((s) => !['dashboard', 'create'].includes(s.key)).map((s) => (
            <Link
              key={s.key}
              href={pqrSectionHref(s.href, selectedPqrId)}
              className={`rounded-md border px-2.5 py-1 ${s.key === 'summary' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50'}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="pqr-select-summary">PQR Number *</Label>
                <Select
                  value={selectedPqrId}
                  onValueChange={(id) => {
                    setSelectedPqrId(id);
                    syncPqrIdToUrl(id);
                  }}
                >
                  <SelectTrigger id="pqr-select-summary" aria-label="Select PQR">
                    <SelectValue placeholder="Select PQR..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pqrs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.pqrNumber} — {p.productName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedPqr && (
                <>
                  <div>
                    <Label className="text-muted-foreground">Product / Code</Label>
                    <p className="text-sm font-medium">{selectedPqr.productName}</p>
                    <p className="text-xs text-muted-foreground">{selectedPqr.productCode || '—'}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Review Period</Label>
                    <p className="text-sm font-medium">
                      {selectedPqr.reviewPeriodFrom || '—'} — {selectedPqr.reviewPeriodTo || '—'}
                    </p>
                  </div>
                  {(selectedPqr.strength || selectedPqr.dosageForm) && (
                    <div>
                      <Label className="text-muted-foreground">Strength / Dosage Form</Label>
                      <p className="text-sm font-medium">
                        {[selectedPqr.strength, selectedPqr.dosageForm].filter(Boolean).join(' / ')}
                      </p>
                    </div>
                  )}
                  {selectedPqr.site && (
                    <div>
                      <Label className="text-muted-foreground">Manufacturing Site</Label>
                      <p className="text-sm font-medium">{selectedPqr.site}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {!selectedPqr ? (
          <EmptyState title="Select a PQR" message="Choose a PQR to generate summary and conclusion." />
        ) : !record ? (
          <EmptyState title="No summary generated" message="Click Generate Summary to consolidate all PQR review sections." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SummaryStatusBadge status={record.status} />
              <QualityStatusBadge status={record.overallQualityStatus} />
              <ProcessStatusBadge status={record.overallProcessStatus} />
              <RiskBadge level={record.overallRiskLevel} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
              <Card>
                <CardContent className="pt-6 flex justify-center">
                  <QualityScoreGauge score={metrics.qualityScore} band={metrics.qualityScoreBand} />
                </CardContent>
              </Card>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-10">
                <KpiCard label="Total Batches" value={metrics.totalBatchesManufactured} />
                <KpiCard label="Released" value={metrics.totalReleasedBatches} tone="green" />
                <KpiCard label="Rejected" value={metrics.totalRejectedBatches} tone="red" />
                <KpiCard label="Avg Cpk" value={metrics.hasCapabilityData ? metrics.averageCpk : 'N/A'} />
                <KpiCard
                  label="Avg Yield"
                  value={metrics.avgYieldPct != null ? `${metrics.avgYieldPct}%` : 'N/A'}
                />
                <KpiCard label="Open CAPA" value={metrics.openCapa} tone="amber" />
                <KpiCard label="Open OOS" value={metrics.openOos} tone="red" />
                <KpiCard label="Change Controls" value={metrics.totalChangeControls} />
                <KpiCard label="High Risks" value={metrics.highRisks} tone="amber" />
                <KpiCard label="Critical Risks" value={metrics.criticalRisks} tone="red" />
              </div>
            </div>

            <Tabs defaultValue="dashboard">
              <TabsList className="flex flex-wrap h-auto">
                <TabsTrigger value="dashboard">Executive Dashboard</TabsTrigger>
                <TabsTrigger value="completion">Section Completion</TabsTrigger>
                <TabsTrigger value="findings">Findings</TabsTrigger>
                <TabsTrigger value="readiness">Approval Readiness</TabsTrigger>
                <TabsTrigger value="narratives">Narrative Sections</TabsTrigger>
                <TabsTrigger value="conclusion">Conclusion & Recommendations</TabsTrigger>
                <TabsTrigger value="approval">Approval Workflow</TabsTrigger>
                <TabsTrigger value="charts">Charts</TabsTrigger>
              </TabsList>

              <TabsContent value="dashboard" className="mt-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[
                    ['Batch Release %', `${metrics.batchReleasePct}%`],
                    ['Material Compliance', `${metrics.materialCompliancePct}%`],
                    ['Packaging Compliance', `${metrics.packagingCompliancePct}%`],
                    ['Equipment Compliance', `${metrics.equipmentCompliancePct}%`],
                    ['Utility Compliance', formatCompliancePct(metrics.utilityCompliancePct, utilTotal)],
                    ['Env Compliance', formatCompliancePct(metrics.environmentalCompliancePct, envTotal)],
                    ['Stability Compliance', `${metrics.stabilityCompliancePct}%`],
                    ['Deviations', `${metrics.totalDeviations} (${metrics.openDeviations} open)`],
                    ['OOS', `${metrics.totalOos} (${metrics.openOos} open)`],
                    ['CAPA', `${metrics.totalCapa} (${metrics.openCapa} open)`],
                    ['Change Controls', `${metrics.totalChangeControls} (${metrics.openChangeControls} open)`],
                    ['Avg Ppk', metrics.hasCapabilityData ? String(metrics.averagePpk) : 'N/A'],
                  ].map(([k, v]) => (
                    <Card key={k}>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">{k}</CardTitle></CardHeader>
                      <CardContent><p className="text-2xl font-semibold text-blue-700">{v}</p></CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="completion" className="mt-4">
                {sectionCompletion.length ? (
                  <div className="space-y-2">
                    {sectionCompletion.map((s) => (
                      <Card key={s.key}>
                        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                          <div>
                            <p className="text-sm font-medium">{s.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.recordCount} record(s)
                              {s.lastUpdated ? ` · Last updated ${s.lastUpdated.slice(0, 10)}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-medium ${s.status === 'Completed' ? 'text-green-700' : 'text-amber-700'}`}>
                              {s.status}
                            </span>
                            <Button variant="outline" size="sm" asChild>
                              <Link href={pqrSectionHref(s.href, selectedPqrId)}>Open</Link>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No section data" message="Generate summary to assess section completion." />
                )}
              </TabsContent>

              <TabsContent value="findings" className="mt-4">
                {findings.length ? (
                  <div className="space-y-2">
                    {findings.map((f) => (
                      <Card key={f.id}>
                        <CardContent className="py-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-medium">{f.id} · {f.category}</p>
                              <p className="text-sm text-muted-foreground mt-1">{f.description}</p>
                              <p className="text-xs text-muted-foreground mt-1">Source: {f.sourceModule}</p>
                            </div>
                            <div className="flex gap-2 text-xs">
                              <span className={`rounded border px-2 py-0.5 ${
                                f.severity === 'Critical' ? 'border-red-300 text-red-700'
                                  : f.severity === 'Major' ? 'border-amber-300 text-amber-700'
                                    : 'border-slate-300 text-slate-600'
                              }`}>{f.severity}</span>
                              <span className="rounded border px-2 py-0.5">{f.status}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No findings" message="Generate summary to derive findings from consolidated data." />
                )}
              </TabsContent>

              <TabsContent value="readiness" className="mt-4">
                {readiness.items.length ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Approval Readiness — {readiness.ready ? 'Ready' : 'Not Ready'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {readiness.items.map((item) => (
                        <div
                          key={item.key}
                          className={`flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm ${
                            item.ok ? 'border-green-200 bg-green-50/50' : 'border-amber-200 bg-amber-50/50'
                          }`}
                        >
                          <div>
                            <p className="font-medium">{item.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                          </div>
                          <span className={`text-xs font-semibold ${item.ok ? 'text-green-700' : 'text-amber-700'}`}>
                            {item.ok ? 'OK' : 'Action needed'}
                          </span>
                        </div>
                      ))}
                      <div className="pt-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={pqrSectionHref('/pqr/approval', selectedPqrId)}>Go to PQR Approval</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <EmptyState title="No readiness data" message="Generate summary to evaluate approval readiness." />
                )}
              </TabsContent>

              <TabsContent value="narratives" className="mt-4 space-y-4">
                {NARRATIVE_FIELDS.map(({ key, label }) => (
                  <Card key={key}>
                    <CardHeader className="pb-2"><CardTitle className="text-sm">{label}</CardTitle></CardHeader>
                    <CardContent>
                      <Textarea
                        className="min-h-[80px]"
                        value={String(record[key] ?? '')}
                        readOnly={locked || !canManage}
                        aria-label={label}
                        onChange={(e) => updateNarrative(key, e.target.value)}
                        onBlur={() => { if (canManage && !locked) void handleSaveFields({ [key]: record[key] }); }}
                      />
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>

              <TabsContent value="conclusion" className="mt-4 space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Final Conclusion</CardTitle></CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[120px]"
                      value={record.finalConclusion}
                      readOnly={locked || !canManage}
                      aria-label="Final conclusion"
                      onChange={(e) => updateNarrative('finalConclusion', e.target.value)}
                      onBlur={() => { if (canManage && !locked) void handleSaveFields({ finalConclusion: record.finalConclusion }); }}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Recommendations</CardTitle></CardHeader>
                  <CardContent>
                    <Textarea
                      className="min-h-[120px]"
                      value={record.recommendations}
                      readOnly={locked || !canManage}
                      aria-label="Recommendations"
                      onChange={(e) => updateNarrative('recommendations', e.target.value)}
                      onBlur={() => { if (canManage && !locked) void handleSaveFields({ recommendations: record.recommendations }); }}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="approval" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader><CardTitle className="text-base">Approval Details</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="summary-reviewed-by">Reviewer *</Label>
                          <Input
                            id="summary-reviewed-by"
                            value={form.reviewedBy}
                            disabled={locked}
                            aria-label="Reviewer name"
                            onChange={(e) => setForm({ ...form, reviewedBy: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label htmlFor="summary-approved-by">Approver *</Label>
                          <Input
                            id="summary-approved-by"
                            value={form.approvedBy}
                            disabled={locked}
                            aria-label="Approver name"
                            onChange={(e) => setForm({ ...form, approvedBy: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor="summary-reviewer-comments">Reviewer Comments</Label>
                        <Textarea
                          id="summary-reviewer-comments"
                          value={form.reviewerComments}
                          disabled={locked}
                          aria-label="Reviewer comments"
                          onChange={(e) => setForm({ ...form, reviewerComments: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="summary-qa-comments">QA Comments</Label>
                        <Textarea
                          id="summary-qa-comments"
                          value={form.qaComments}
                          disabled={locked}
                          aria-label="QA comments"
                          onChange={(e) => setForm({ ...form, qaComments: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="summary-head-qa-comments">Head QA Comments</Label>
                        <Textarea
                          id="summary-head-qa-comments"
                          value={form.headQaComments}
                          disabled={locked}
                          aria-label="Head QA comments"
                          onChange={(e) => setForm({ ...form, headQaComments: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="summary-final-comments">Final Approval Comments</Label>
                        <Textarea
                          id="summary-final-comments"
                          value={form.finalApprovalComments}
                          disabled={locked}
                          aria-label="Final approval comments"
                          onChange={(e) => setForm({ ...form, finalApprovalComments: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canManage && !locked && (
                          <Button variant="outline" onClick={() => void handleSubmitReview()} disabled={busy}>
                            <Send className="h-4 w-4 mr-1" />Submit for Review
                          </Button>
                        )}
                        {canApprove && !locked && (
                          <>
                            <Button onClick={() => setEsignOpen(true)} disabled={busy}>
                              <CheckCircle className="h-4 w-4 mr-1" />Approve
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => { setRejectComments(''); setRejectOpen(true); }}
                              disabled={busy}
                            >
                              <XCircle className="h-4 w-4 mr-1" />Reject
                            </Button>
                          </>
                        )}
                        {canManage && record.status === 'Approved' && (
                          <Button variant="outline" onClick={() => void handleArchive()} disabled={busy}>
                            <Archive className="h-4 w-4 mr-1" />Archive
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle className="text-base">Approval Timeline</CardTitle></CardHeader>
                    <CardContent>
                      <ApprovalTimeline
                        status={record.status}
                        approvalDate={record.approvalDate}
                        reviewedBy={record.reviewedBy}
                        approvedBy={record.approvedBy}
                      />
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="charts" className="mt-4">
                {charts ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <SafeChart title="Batch Release Trend" empty={!charts.batchReleaseTrend.length}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts.batchReleaseTrend}>
                          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                          <Line type="monotone" dataKey="released" stroke="#059669" />
                          <Line type="monotone" dataKey="rejected" stroke="#dc2626" />
                        </LineChart>
                      </ResponsiveContainer>
                    </SafeChart>
                    <SafeChart title="Deviation Trend" empty={!charts.deviationTrend.length}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts.deviationTrend}>
                          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip />
                          <Line type="monotone" dataKey="count" stroke="#2563eb" />
                        </LineChart>
                      </ResponsiveContainer>
                    </SafeChart>
                    <SafeChart title="OOS Trend" empty={!charts.oosTrend.length}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts.oosTrend}>
                          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip />
                          <Line type="monotone" dataKey="count" stroke="#dc2626" />
                        </LineChart>
                      </ResponsiveContainer>
                    </SafeChart>
                    <SafeChart title="CAPA Trend" empty={!charts.capaTrend.length}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts.capaTrend}>
                          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip />
                          <Line type="monotone" dataKey="count" stroke="#d97706" />
                        </LineChart>
                      </ResponsiveContainer>
                    </SafeChart>
                    <SafeChart title="Risk Distribution" empty={!charts.riskDistribution.length}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={charts.riskDistribution} dataKey="count" nameKey="level" outerRadius={70} label>
                            {charts.riskDistribution.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </SafeChart>
                    <SafeChart title="Cpk Trend" empty={!charts.cpkTrend.length}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts.cpkTrend}>
                          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis domain={[0, 2]} /><Tooltip />
                          <Line type="monotone" dataKey="cpk" stroke="#2563eb" />
                        </LineChart>
                      </ResponsiveContainer>
                    </SafeChart>
                    <SafeChart title="Stability Trend" empty={!charts.stabilityTrend.length}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={charts.stabilityTrend}>
                          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />
                          <Line type="monotone" dataKey="compliant" stroke="#059669" />
                          <Line type="monotone" dataKey="nonCompliant" stroke="#dc2626" />
                        </LineChart>
                      </ResponsiveContainer>
                    </SafeChart>
                    <SafeChart title="Quality Score" empty={!charts.qualityScoreTrend.length}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={charts.qualityScoreTrend}>
                          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis domain={[0, 100]} /><Tooltip />
                          <Bar dataKey="score" fill="#2563eb" />
                        </BarChart>
                      </ResponsiveContainer>
                    </SafeChart>
                  </div>
                ) : (
                  <EmptyState title="No charts" message="Generate summary to view charts." />
                )}
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              {sectionNav.prev ? (
                <Button variant="outline" asChild>
                  <Link href={sectionNav.prev.href}>
                    <ChevronLeft className="h-4 w-4 mr-1" />{sectionNav.prev.label}
                  </Link>
                </Button>
              ) : <span />}
              <div className="flex flex-wrap gap-2 text-xs">
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/batches', selectedPqrId)}>Batches</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/materials', selectedPqrId)}>Materials</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/packaging', selectedPqrId)}>Packaging</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/equipment-review', selectedPqrId)}>Equipment</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/utility-review', selectedPqrId)}>Utility</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/stability', selectedPqrId)}>Stability</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/approval', selectedPqrId)}>PQR Approval</Link>
                <Link className="text-blue-600 hover:underline" href={pqrSectionHref('/pqr/dashboard', selectedPqrId)}>PQR Dashboard</Link>
              </div>
              {sectionNav.next ? (
                <Button variant="outline" asChild>
                  <Link href={sectionNav.next.href}>
                    {sectionNav.next.label}<ChevronRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              ) : <span />}
            </div>
          </>
        )}

        <Dialog open={esignOpen} onOpenChange={setEsignOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Electronic Signature — Final Approval</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="esign-password">Password *</Label>
                <Input
                  id="esign-password"
                  type="password"
                  value={esignPassword}
                  aria-label="E-signature password"
                  onChange={(e) => setEsignPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="esign-reason">Reason for Signature *</Label>
                <Textarea
                  id="esign-reason"
                  value={esignReason}
                  aria-label="Reason for electronic signature"
                  onChange={(e) => setEsignReason(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEsignOpen(false)}>Cancel</Button>
              <Button onClick={() => void handleApprove()} disabled={busy}>
                <Save className="h-4 w-4 mr-1" />Sign & Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Summary</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="reject-comments">Rejection Comments *</Label>
                <Textarea
                  id="reject-comments"
                  className="min-h-[100px]"
                  value={rejectComments}
                  aria-label="Rejection comments"
                  placeholder="Describe the reason for rejection..."
                  onChange={(e) => setRejectComments(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => void handleReject()}
                disabled={busy || !rejectComments.trim()}
              >
                <XCircle className="h-4 w-4 mr-1" />Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </SummaryConclusionAccessGuard>
  );
}
