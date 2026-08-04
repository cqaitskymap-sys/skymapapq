'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, FileText, Loader2,
  Save, Search, Send, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase';
import { downloadCsv } from '@/lib/export-utils';
import {
  PQR_FREQUENCIES, PQR_TYPES, REVIEW_SCOPE_OPTIONS,
  canExportAnnualPqr, canSubmitAnnualPqr, defaultReviewScope, reviewPeriodSchema,
  type PqrBatchOption, type PqrCollectedData, type PqrProductOption,
  type PqrSectionRecord, type PqrTeamMember, type PqrType,
} from '@/lib/pqr-create-records';
import {
  checkPqrConflicts, collectPqrData, computeOverallAssessment,
  createAnnualPqrDraft, exportCreateSummaryCsv, fetchEligibleBatches,
  fetchPqrCreateProducts, fetchPqrSections, fetchPqrTeamCandidates,
  loadPqrDraft, logPqrCreateExport, logPqrCreateOverride,
  logPqrCreatePeriodSelected, logPqrCreateProductSelected, logPqrCreateView,
  previewAnnualPqrNumber, savePqrDraft, submitPqrForReview,
  updatePqrSectionNarrative, uploadPqrAttachment,
} from '@/lib/pqr-create-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PqrCreateAccessGuard } from './pqr-create-access-guard';
import { DataPreviewCard } from './data-preview-card';
import { PqrSectionEditor } from './pqr-section-editor';
import { AttachmentUploader } from './attachment-uploader';
import { PqrWizard } from './pqr-wizard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { qualityStatusColor, riskLevelColor } from '@/lib/pqr-create-records';

function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y - 3, y - 2, y - 1, y, y + 1];
}

export function CreateAnnualPqrPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeId = searchParams.get('id');
  const { user, profile } = useAuth();
  const canExport = canExportAnnualPqr(profile?.role);
  const canSubmit = canSubmitAnnualPqr(profile?.role);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<PqrProductOption[]>([]);
  const [team, setTeam] = useState<PqrTeamMember[]>([]);
  const [eligibleBatches, setEligibleBatches] = useState<PqrBatchOption[]>([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [batchSearch, setBatchSearch] = useState('');
  const [batchStatusFilter, setBatchStatusFilter] = useState('all');
  const [loadingBatches, setLoadingBatches] = useState(false);

  const [productId, setProductId] = useState('');
  const [pqrType, setPqrType] = useState<PqrType>('Annual');
  const [reviewYear, setReviewYear] = useState(new Date().getFullYear());
  const [periodFrom, setPeriodFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [periodTo, setPeriodTo] = useState(`${new Date().getFullYear()}-12-31`);
  const [pqrFrequency, setPqrFrequency] = useState<(typeof PQR_FREQUENCIES)[number]>('Yearly');
  const [dueDate, setDueDate] = useState(`${new Date().getFullYear() + 1}-03-31`);
  const [site, setSite] = useState('');
  const [plant, setPlant] = useState('');
  const [department, setDepartment] = useState('Quality Assurance');
  const [description, setDescription] = useState('');
  const [pqrOwner, setPqrOwner] = useState('');
  const [qaReviewer, setQaReviewer] = useState('');
  const [qcReviewer, setQcReviewer] = useState('');
  const [productionReviewer, setProductionReviewer] = useState('');
  const [engineeringReviewer, setEngineeringReviewer] = useState('');
  const [regulatoryReviewer, setRegulatoryReviewer] = useState('');
  const [finalApprover, setFinalApprover] = useState('');
  const [reviewScope, setReviewScope] = useState(defaultReviewScope());
  const [collectedData, setCollectedData] = useState<PqrCollectedData | null>(null);
  const [pqrNumber, setPqrNumber] = useState('');
  const [pqrId, setPqrId] = useState<string | null>(null);
  const [sections, setSections] = useState<PqrSectionRecord[]>([]);
  const [executiveSummary, setExecutiveSummary] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [remarks, setRemarks] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selected = useMemo(() => {
    const [source, id] = productId.includes(':') ? productId.split(':') : ['', productId];
    return products.find((p) => (source ? p.source === source && p.id === id : p.id === productId)) || null;
  }, [products, productId]);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role: profile?.role,
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role]);

  const assessment = useMemo(
    () => (collectedData?.loadState === 'ok' || collectedData?.loadState === 'empty'
      ? computeOverallAssessment(collectedData.summary)
      : null),
    [collectedData],
  );

  const filteredBatches = useMemo(() => {
    const q = batchSearch.toLowerCase().trim();
    return eligibleBatches.filter((b) => {
      if (batchStatusFilter !== 'all') {
        const st = `${b.batchStatus} ${b.releaseStatus}`.toLowerCase();
        if (!st.includes(batchStatusFilter.toLowerCase())) return false;
      }
      if (!q) return true;
      return [b.batchNumber, b.manufacturingSite, b.batchStatus, b.releaseStatus]
        .join(' ').toLowerCase().includes(q);
    });
  }, [eligibleBatches, batchSearch, batchStatusFilter]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) {
        setError('Firebase is not configured. Set environment variables to create PQR records.');
        return;
      }
      const [prods, members] = await Promise.all([
        fetchPqrCreateProducts(),
        fetchPqrTeamCandidates(),
      ]);
      setProducts(prods);
      setTeam(members);
      if (!pqrOwner) setPqrOwner(actor.name);
    } catch {
      setError('Failed to load products and team members.');
    } finally {
      setLoading(false);
    }
  }, [actor.name, pqrOwner]);

  useEffect(() => { void loadProducts(); void logPqrCreateView(actor); }, [loadProducts, actor]);

  // Resume draft
  useEffect(() => {
    if (!resumeId || !isFirebaseConfigured()) return;
    void (async () => {
      setBusy(true);
      try {
        const draft = await loadPqrDraft(resumeId);
        if (!draft) {
          toast.error('Draft not found');
          return;
        }
        setPqrId(draft.id || resumeId);
        setPqrNumber(draft.pqrNumber);
        setPeriodFrom(draft.reviewPeriodFrom);
        setPeriodTo(draft.reviewPeriodTo);
        setReviewYear(draft.reviewYear);
        setPqrFrequency(draft.pqrFrequency);
        setDueDate(draft.dueDate);
        setPqrOwner(draft.pqrOwner);
        setQaReviewer(draft.qaReviewer || '');
        setQcReviewer(draft.qcReviewer || '');
        setProductionReviewer(draft.productionReviewer || '');
        setEngineeringReviewer(draft.engineeringReviewer || '');
        setRegulatoryReviewer(draft.regulatoryReviewer || '');
        setFinalApprover(draft.finalApprover || '');
        setSite(draft.site || '');
        setPlant(draft.plant || '');
        setDepartment(draft.department || '');
        setDescription(draft.description || '');
        setExecutiveSummary(draft.executiveSummary || '');
        setConclusion(draft.conclusion || '');
        setRecommendations(draft.recommendations || '');
        setRemarks(draft.remarks || '');
        setSelectedBatchIds(draft.selectedBatchIds || []);
        if (draft.reviewScope) setReviewScope(draft.reviewScope);
        const secs = await fetchPqrSections(draft.id || resumeId);
        setSections(secs);
        setStep(7);
        toast.success(`Resumed draft ${draft.pqrNumber}`);
      } catch {
        toast.error('Failed to resume draft');
      } finally {
        setBusy(false);
      }
    })();
  }, [resumeId]);

  useEffect(() => {
    if (pqrFrequency === 'Custom') return;
    setPeriodFrom(`${reviewYear}-01-01`);
    setPeriodTo(`${reviewYear}-12-31`);
    setDueDate(`${reviewYear + 1}-03-31`);
  }, [reviewYear, pqrFrequency]);

  useEffect(() => {
    if (!selected) return;
    void previewAnnualPqrNumber(selected.productCode, reviewYear).then(setPqrNumber);
    if (selected.manufacturingSite && !site) setSite(selected.manufacturingSite);
  }, [selected, reviewYear, site]);

  useEffect(() => {
    if (assessment) {
      setConclusion((c) => c || assessment.conclusion);
      setRecommendations((r) => r || assessment.recommendations);
    }
  }, [assessment]);

  const loadBatches = async () => {
    if (!selected) return;
    setLoadingBatches(true);
    try {
      const rows = await fetchEligibleBatches(selected, periodFrom, periodTo, site || undefined);
      setEligibleBatches(rows);
      // Auto-select all eligible by default for review, user can deselect
      setSelectedBatchIds((prev) => (prev.length ? prev.filter((id) => rows.some((r) => r.id === id)) : rows.map((r) => r.id)));
      if (!rows.length) toast.info('No eligible batches found for this product and period');
    } catch {
      toast.error('Failed to load batches');
      setEligibleBatches([]);
    } finally {
      setLoadingBatches(false);
    }
  };

  const validatePeriod = async (allowOverride = false) => {
    const parsed = reviewPeriodSchema.safeParse({
      reviewPeriodFrom: periodFrom,
      reviewPeriodTo: periodTo,
      reviewYear,
      pqrFrequency,
      dueDate,
      allowFuture: false,
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Invalid review period');
      return false;
    }
    if (!selected) return false;
    const conflicts = await checkPqrConflicts({
      productId: selected.id,
      productName: selected.productName,
      productCode: selected.productCode,
      from: periodFrom,
      to: periodTo,
      pqrNumber,
      site: site || undefined,
    });
    if ((conflicts.overlap || conflicts.activeDraft || conflicts.duplicateNumber) && !allowOverride) {
      setOverlapWarning(conflicts.warning || `Existing PQR ${conflicts.existingPqrNumber} conflicts with this period.`);
      setOverrideOpen(true);
      return false;
    }
    setOverlapWarning(null);
    await logPqrCreatePeriodSelected(actor, periodFrom, periodTo);
    return true;
  };

  const runDataCollection = async () => {
    if (!selected) return;
    if (reviewScope.batchReview && !selectedBatchIds.length) {
      toast.error('Select at least one batch or disable Batch Review in scope');
      return;
    }
    setBusy(true);
    setCollectedData(null);
    try {
      const data = await collectPqrData(selected, periodFrom, periodTo, reviewScope, actor, {
        selectedBatchIds,
      });
      setCollectedData(data);
      if (data.loadState === 'error') {
        toast.error(data.loadError || 'Data collection failed');
        return;
      }
      setExecutiveSummary(
        `Annual PQR for ${selected.productName} (${periodFrom} to ${periodTo}). `
        + `${data.summary.totalBatches} batches, ${data.summary.deviations} deviations, ${data.summary.oos} OOS reviewed.`,
      );
      if (data.loadState === 'empty') toast.info('Collection completed — no matching records for some sources');
      else toast.success('Data collection completed');
      setStep(5);
    } catch {
      toast.error('Data collection failed');
      setCollectedData({
        summary: {
          totalBatches: 0, releasedBatches: 0, rejectedBatches: 0, rawMaterialLots: 0, packingMaterialLots: 0,
          cppRecords: 0, cqaRecords: 0, yieldRecords: 0, stabilityRecords: 0, holdTimeRecords: 0,
          deviations: 0, oos: 0, oot: 0, capa: 0, changeControls: 0, complaints: 0, recalls: 0,
          validationRecords: 0, equipmentRecords: 0, vendorRecords: 0, riskRecords: 0,
          averageCpk: 0, openCriticalOos: 0, openCriticalDeviations: 0, openCapa: 0,
        },
        loadState: 'error',
        loadError: 'Unexpected collection failure',
        batches: [], rawMaterials: [], packingMaterials: [], cppResults: [], cqaResults: [],
        yieldRecords: [], stabilityRecords: [], holdTimeRecords: [], deviations: [], oosRecords: [],
        capaRecords: [], changeControls: [], complaints: [], recalls: [], validationRecords: [],
        equipmentRecords: [], vendorRecords: [], capabilityRecords: [], riskRecords: [],
      });
    } finally {
      setBusy(false);
    }
  };

  const generateDraft = async () => {
    if (!selected || !collectedData || collectedData.loadState === 'error') {
      toast.error('Complete data collection before generating the draft');
      return;
    }
    if (!pqrOwner.trim()) {
      toast.error('PQR Owner is required');
      return;
    }
    setBusy(true);
    try {
      const batchNumbers = eligibleBatches
        .filter((b) => selectedBatchIds.includes(b.id))
        .map((b) => b.batchNumber);
      const result = await createAnnualPqrDraft({
        product: selected,
        reviewPeriodFrom: periodFrom,
        reviewPeriodTo: periodTo,
        reviewYear,
        pqrFrequency,
        dueDate,
        pqrOwner: pqrOwner || actor.name,
        reviewScope,
        collectedData,
        pqrNumber,
        qaOverride: Boolean(overlapWarning),
        actor,
        selectedBatchIds,
        selectedBatchNumbers: batchNumbers,
        pqrType,
        site: site || selected.manufacturingSite,
        plant,
        department,
        description,
        qaReviewer,
        qcReviewer,
        productionReviewer,
        engineeringReviewer,
        regulatoryReviewer,
        finalApprover,
      });
      if (result.error || !result.pqrId) {
        toast.error(result.error || 'Failed to generate PQR draft');
        return;
      }
      setPqrId(result.pqrId);
      setPqrNumber(result.pqrNumber);
      const loaded = await fetchPqrSections(result.pqrId);
      setSections(loaded.length ? loaded : result.sections.map((s, i) => ({ ...s, id: `local-${i}` })));
      toast.success(`PQR ${result.pqrNumber} draft generated`);
      setStep(7);
    } catch {
      toast.error('Failed to generate PQR draft');
    } finally {
      setBusy(false);
    }
  };

  const handleSectionChange = async (sectionId: string, narrative: string) => {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, narrative } : s)));
    if (!sectionId.startsWith('local-')) {
      await updatePqrSectionNarrative(sectionId, narrative, actor);
    }
  };

  const handleSaveDraft = async () => {
    if (!pqrId) {
      toast.info('Generate the PQR draft first to save');
      return;
    }
    setBusy(true);
    const { error: err } = await savePqrDraft(pqrId, {
      executiveSummary, conclusion, recommendations, remarks, status: 'Draft',
    }, actor);
    setBusy(false);
    if (err) toast.error(err);
    else toast.success('Draft saved — you can resume later from Create Annual PQR?id=' + pqrId);
  };

  const handleSubmit = async () => {
    if (!pqrId || !canSubmit) return;
    if (!executiveSummary.trim() || !conclusion.trim()) {
      toast.error('Executive Summary and Conclusion are required before submission');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setBusy(true);
    await savePqrDraft(pqrId, { executiveSummary, conclusion, recommendations, remarks }, actor);
    const { error: err } = await submitPqrForReview(pqrId, actor);
    setBusy(false);
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success('PQR submitted for review');
      router.push(`/pqr/${pqrId}/approval`);
    }
  };

  const nextStep = async () => {
    if (step === 1) {
      if (!selected) return toast.error('Select a product');
      await logPqrCreateProductSelected(actor, selected);
      setStep(2);
    } else if (step === 2) {
      const ok = await validatePeriod();
      if (ok) {
        setStep(3);
        void loadBatches();
      }
    } else if (step === 3) {
      if (reviewScope.batchReview && !selectedBatchIds.length && eligibleBatches.length) {
        return toast.error('Select at least one batch, or go back and disable Batch Review');
      }
      setStep(4);
    } else if (step === 4) {
      const required = REVIEW_SCOPE_OPTIONS.filter((o) => o.required);
      if (required.some((o) => !reviewScope[o.key])) {
        return toast.error('Required review scopes must remain enabled');
      }
      setStep(5);
      await runDataCollection();
    } else if (step === 5) {
      if (!collectedData || collectedData.loadState === 'error') {
        await runDataCollection();
        return;
      }
      setStep(6);
    } else if (step === 6) {
      await generateDraft();
    } else if (step === 7) {
      if (!executiveSummary.trim()) return toast.error('Executive Summary is required');
      setStep(8);
    }
  };

  const exportPdf = () => {
    void logPqrCreateExport(actor, 'pdf');
    if (collectedData) {
      exportCreateSummaryCsv(collectedData.summary, selected?.productName || 'product', `${periodFrom}_${periodTo}`);
      toast.success('Summary exported as CSV (PDF layout coming later)');
    } else toast.info('Collect data before exporting');
  };

  const exportExcel = () => {
    void logPqrCreateExport(actor, 'excel');
    if (!collectedData) return toast.info('Collect data before exporting');
    downloadCsv(`pqr-create-${selected?.productCode || 'draft'}.csv`, [
      'Metric', 'Value',
    ], Object.entries(collectedData.summary).map(([k, v]) => [k, v]));
    toast.success('Excel-compatible CSV exported');
  };

  const toggleBatch = (id: string) => {
    setSelectedBatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllBatches = () => setSelectedBatchIds(filteredBatches.map((b) => b.id));
  const deselectAllBatches = () => setSelectedBatchIds([]);

  const autoSelectEligible = () => {
    setSelectedBatchIds(eligibleBatches.map((b) => b.id));
    toast.success(`${eligibleBatches.length} eligible batch(es) selected — review before continuing`);
  };

  const teamOptions = (roleHint?: string) => {
    const hint = (roleHint || '').toLowerCase();
    const filtered = hint
      ? team.filter((t) => t.role.toLowerCase().includes(hint) || t.department.toLowerCase().includes(hint))
      : team;
    return filtered.length ? filtered : team;
  };

  if (loading) {
    return (
      <PqrCreateAccessGuard>
        <div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div>
      </PqrCreateAccessGuard>
    );
  }

  if (error) {
    return (
      <PqrCreateAccessGuard>
        <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void loadProducts()} /></div>
      </PqrCreateAccessGuard>
    );
  }

  const summary = collectedData?.summary;

  return (
    <PqrCreateAccessGuard>
      <div className="space-y-6 p-4 sm:p-6 max-w-5xl mx-auto">
        <CpvPageHeader
          title="Create Annual PQR"
          description="Generate annual Product Quality Review from Product Master, Batch Master and QMS data"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'Create Annual PQR' },
          ]}
          actions={canExport ? (
            <>
              <Button variant="outline" size="sm" onClick={exportPdf} aria-label="Export summary"><FileText className="h-4 w-4 mr-1" />CSV</Button>
              <Button variant="outline" size="sm" onClick={exportExcel} aria-label="Export excel"><FileSpreadsheet className="h-4 w-4 mr-1" />Excel</Button>
            </>
          ) : undefined}
        />

        <PqrWizard step={step} />

        {/* Step 1: Product */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Step 1 — Select Product</CardTitle>
              <CardDescription>Products from Product Master and CPV Product Master (active only)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="product">Product *</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger id="product" aria-label="Select product"><SelectValue placeholder="Select product..." /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={`${p.source}-${p.id}`} value={`${p.source}:${p.id}`}>
                          {p.productName} ({p.productCode})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>PQR Type</Label>
                  <Select value={pqrType} onValueChange={(v) => setPqrType(v as PqrType)}>
                    <SelectTrigger aria-label="PQR type"><SelectValue /></SelectTrigger>
                    <SelectContent>{PQR_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
                </div>
              </div>
              {selected && (
                <div className="grid gap-3 sm:grid-cols-2 rounded-lg border bg-slate-50 p-4 text-sm" aria-live="polite">
                  {[
                    ['Product Code', selected.productCode], ['Generic Name', selected.genericName],
                    ['Brand Name', selected.brandName], ['Strength', selected.strength],
                    ['Dosage Form', selected.dosageForm], ['Product Type', selected.productType],
                    ['Version', selected.productVersion], ['Mfg Site', selected.manufacturingSite],
                    ['Status', selected.status], ['Lifecycle', selected.lifecycleStatus],
                    ['Pack Size', selected.packSize], ['Market', selected.market],
                    ['Shelf Life', selected.shelfLife], ['Storage', selected.storageCondition],
                    ['MFR', selected.mfrNumber], ['BMR', selected.bmrNumber],
                  ].map(([k, v]) => (
                    <div key={k}><span className="text-muted-foreground">{k}: </span><span className="font-medium">{v || '—'}</span></div>
                  ))}
                </div>
              )}
              {!products.length && <EmptyState title="No active products" message="Add products in Admin Product Master or CPV Product Master first." />}
            </CardContent>
          </Card>
        )}

        {/* Step 2: Review Period */}
        {step === 2 && (
          <Card>
            <CardHeader><CardTitle>Step 2 — Review Period & Basic Information</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="from">Review Period From *</Label><Input id="from" type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="to">Review Period To *</Label><Input id="to" type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Review Year</Label>
                <Select value={String(reviewYear)} onValueChange={(v) => setReviewYear(Number(v))}>
                  <SelectTrigger aria-label="Review year"><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions().map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>PQR Frequency</Label>
                <Select value={pqrFrequency} onValueChange={(v) => setPqrFrequency(v as typeof pqrFrequency)}>
                  <SelectTrigger aria-label="Frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>{PQR_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label htmlFor="due">Due Date *</Label><Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="site">Site / Plant</Label><Input id="site" value={site} onChange={(e) => setSite(e.target.value)} placeholder={selected?.manufacturingSite || 'Manufacturing site'} /></div>
              <div className="space-y-2"><Label htmlFor="plant">Plant</Label><Input id="plant" value={plant} onChange={(e) => setPlant(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="dept">Department</Label><Input id="dept" value={department} onChange={(e) => setDepartment(e.target.value)} /></div>
              <div className="sm:col-span-2 space-y-2">
                <Label>PQR Number (preview — allocated on create)</Label>
                <Input readOnly value={pqrNumber} className="font-mono bg-slate-50" aria-label="PQR number preview" />
              </div>
              {overlapWarning && <p className="sm:col-span-2 text-sm text-amber-800" role="alert">{overlapWarning}</p>}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Batches */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Step 3 — Batch Selection</CardTitle>
              <CardDescription>Only batches for the selected product within the review period are listed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void loadBatches()} disabled={loadingBatches}>
                  {loadingBatches ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                  Refresh Batches
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={autoSelectEligible} disabled={!eligibleBatches.length}>Auto Select Eligible</Button>
                <Button type="button" variant="outline" size="sm" onClick={selectAllBatches} disabled={!filteredBatches.length}>Select All</Button>
                <Button type="button" variant="outline" size="sm" onClick={deselectAllBatches}>Deselect All</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input className="pl-8" placeholder="Search batch…" value={batchSearch} onChange={(e) => setBatchSearch(e.target.value)} aria-label="Search batches" />
                </div>
                <Select value={batchStatusFilter} onValueChange={setBatchStatusFilter}>
                  <SelectTrigger className="w-[160px]" aria-label="Batch status filter"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="release">Released</SelectItem>
                    <SelectItem value="reject">Rejected</SelectItem>
                    <SelectItem value="hold">Hold</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-sm text-muted-foreground">{selectedBatchIds.length} of {eligibleBatches.length} batch(es) selected</p>
              {loadingBatches ? (
                <div className="flex justify-center py-8 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading batches…</div>
              ) : !filteredBatches.length ? (
                <EmptyState title="No batches found" message="No Batch Master records match this product and review period." />
              ) : (
                <div className="max-h-80 overflow-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-left">
                        <th className="p-2 w-10" />
                        <th className="p-2">Batch No</th>
                        <th className="p-2 hidden sm:table-cell">Mfg Date</th>
                        <th className="p-2 hidden md:table-cell">Expiry</th>
                        <th className="p-2 hidden lg:table-cell">Size</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBatches.map((b) => (
                        <tr key={b.id} className="border-t hover:bg-slate-50">
                          <td className="p-2">
                            <Checkbox
                              checked={selectedBatchIds.includes(b.id)}
                              onCheckedChange={() => toggleBatch(b.id)}
                              aria-label={`Select batch ${b.batchNumber}`}
                            />
                          </td>
                          <td className="p-2 font-mono">{b.batchNumber}</td>
                          <td className="p-2 hidden sm:table-cell">{b.manufacturingDate || '—'}</td>
                          <td className="p-2 hidden md:table-cell">{b.expiryDate || '—'}</td>
                          <td className="p-2 hidden lg:table-cell">{b.batchSize || '—'}</td>
                          <td className="p-2"><Badge variant="outline">{b.releaseStatus || b.batchStatus || '—'}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 4: Scope */}
        {step === 4 && (
          <Card>
            <CardHeader>
              <CardTitle>Step 4 — Review Scope & Data Sources</CardTitle>
              <CardDescription>Enable modules to include. Data is retrieved from the live source modules — not duplicated.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {REVIEW_SCOPE_OPTIONS.map((opt) => (
                  <label key={opt.key} className="flex items-start gap-2 text-sm cursor-pointer rounded-md border p-2 hover:bg-slate-50">
                    <Checkbox
                      checked={reviewScope[opt.key]}
                      disabled={opt.required}
                      onCheckedChange={(v) => setReviewScope((s) => ({ ...s, [opt.key]: Boolean(v) }))}
                      aria-label={opt.label}
                    />
                    <span>
                      <span className="font-medium">{opt.label}</span>
                      <span className="block text-xs text-muted-foreground">{opt.required ? 'Required' : 'Optional'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Collect & Preview */}
        {step === 5 && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-blue-600" />Step 5 — Collect & Preview Data</CardTitle>
                <CardDescription>Live Firebase data for the selected product, period and batches</CardDescription>
              </CardHeader>
              <CardContent>
                {busy && !collectedData && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                    <Loader2 className="h-5 w-5 animate-spin" />Collecting data from Firebase…
                  </div>
                )}
                {collectedData?.loadState === 'error' && (
                  <ErrorCard message={collectedData.loadError || 'Collection failed'} onRetry={() => void runDataCollection()} />
                )}
                {collectedData && collectedData.loadState !== 'error' && summary && (
                  <>
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6 mb-4">
                      {[
                        ['Batches', summary.totalBatches], ['Released', summary.releasedBatches], ['Rejected', summary.rejectedBatches],
                        ['Deviations', summary.deviations], ['OOS', summary.oos], ['OOT', summary.oot],
                        ['CAPA', summary.capa], ['Change Controls', summary.changeControls],
                        ['Complaints', summary.complaints], ['Stability', summary.stabilityRecords],
                        ['CPV / Cpk', summary.averageCpk.toFixed(2)], ['Risk', summary.riskRecords],
                      ].map(([label, value]) => (
                        <KpiCard key={String(label)} label={String(label)} value={value as string | number} />
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <DataPreviewCard title="Batch Summary" loadState={collectedData.loadState} items={[
                        { label: 'Total', value: summary.totalBatches }, { label: 'Released', value: summary.releasedBatches },
                        { label: 'Rejected', value: summary.rejectedBatches },
                      ]} />
                      <DataPreviewCard title="Quality Events" loadState={collectedData.loadState} items={[
                        { label: 'Deviations', value: summary.deviations }, { label: 'OOS', value: summary.oos },
                        { label: 'OOT', value: summary.oot }, { label: 'CAPA', value: summary.capa },
                      ]} />
                      <DataPreviewCard title="Materials" loadState={collectedData.loadState} items={[
                        { label: 'Raw Material Lots', value: summary.rawMaterialLots },
                        { label: 'Packing Lots', value: summary.packingMaterialLots },
                      ]} />
                      <DataPreviewCard title="Market / Stability" loadState={collectedData.loadState} items={[
                        { label: 'Complaints', value: summary.complaints }, { label: 'Recalls', value: summary.recalls },
                        { label: 'Stability', value: summary.stabilityRecords },
                      ]} />
                    </div>
                  </>
                )}
                {!busy && !collectedData && (
                  <EmptyState title="Ready to collect" message="Click Collect Data to pull live records." />
                )}
              </CardContent>
            </Card>
            {assessment && (
              <Card>
                <CardContent className="pt-6 flex flex-wrap gap-3">
                  <Badge className={qualityStatusColor(assessment.overallQualityStatus)}>{assessment.overallQualityStatus}</Badge>
                  <Badge className={riskLevelColor(assessment.overallRiskLevel)}>Risk: {assessment.overallRiskLevel}</Badge>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Step 6: Team & Generate */}
        {step === 6 && (
          <Card>
            <CardHeader>
              <CardTitle>Step 6 — Team & Generate Draft</CardTitle>
              <CardDescription>Assign reviewers from User Management, then generate the PQR record</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {([
                  ['PQR Owner *', pqrOwner, setPqrOwner, 'qa'],
                  ['QA Reviewer', qaReviewer, setQaReviewer, 'qa'],
                  ['QC Reviewer', qcReviewer, setQcReviewer, 'qc'],
                  ['Production Reviewer', productionReviewer, setProductionReviewer, 'production'],
                  ['Engineering Reviewer', engineeringReviewer, setEngineeringReviewer, 'engineering'],
                  ['Regulatory Reviewer', regulatoryReviewer, setRegulatoryReviewer, 'regulatory'],
                  ['Final Approver', finalApprover, setFinalApprover, 'qa'],
                ] as const).map(([label, value, setter, hint]) => (
                  <div key={label} className="space-y-2">
                    <Label>{label}</Label>
                    <Select value={value || '__manual__'} onValueChange={(v) => setter(v === '__manual__' ? '' : v)}>
                      <SelectTrigger aria-label={label}><SelectValue placeholder="Select user…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__manual__">— Manual / later —</SelectItem>
                        {teamOptions(hint).map((t) => (
                          <SelectItem key={t.id} value={t.name}>
                            {t.name} ({t.role}{t.department ? ` · ${t.department}` : ''})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input value={value} onChange={(e) => setter(e.target.value)} placeholder="Or type name" aria-label={`${label} manual`} />
                  </div>
                ))}
              </div>
              <div className="rounded-md border bg-slate-50 p-3 text-sm space-y-1">
                <p>PQR Number: <strong className="font-mono">{pqrNumber || '(allocated on create)'}</strong></p>
                <p>Product: <strong>{selected?.productName}</strong></p>
                <p>Period: <strong>{periodFrom}</strong> → <strong>{periodTo}</strong></p>
                <p>Batches: <strong>{selectedBatchIds.length}</strong></p>
                <p>Sections will be generated from selected review scope and live collected data.</p>
              </div>
              {busy && (
                <div className="flex items-center gap-2 text-muted-foreground py-2">
                  <Loader2 className="h-5 w-5 animate-spin" />Generating PQR draft…
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 7: Edit */}
        {step === 7 && (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Step 7 — Edit Section Narratives</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2"><Label htmlFor="exec">Executive Summary *</Label><Textarea id="exec" value={executiveSummary} onChange={(e) => setExecutiveSummary(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="conc">Conclusion *</Label><Textarea id="conc" value={conclusion} onChange={(e) => setConclusion(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="rec">Recommendations</Label><Textarea id="rec" value={recommendations} onChange={(e) => setRecommendations(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="rem">Remarks</Label><Textarea id="rem" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
                {pqrId && (
                  <AttachmentUploader
                    onUpload={async (file) => {
                      const res = await uploadPqrAttachment(pqrId, file, actor);
                      return res;
                    }}
                    disabled={busy}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Section Editor</CardTitle></CardHeader>
              <CardContent>
                <PqrSectionEditor sections={sections.filter((s) => s.included !== false)} onChange={handleSectionChange} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 8: Submit */}
        {step === 8 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-600" />Step 8 — Submit for Review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">PQR <strong className="font-mono">{pqrNumber}</strong> will start the Approval Matrix workflow.</p>
              {assessment && (
                <div className="flex flex-wrap gap-2">
                  <Badge className={qualityStatusColor(assessment.overallQualityStatus)}>{assessment.overallQualityStatus}</Badge>
                  <Badge className={riskLevelColor(assessment.overallRiskLevel)}>{assessment.overallRiskLevel} Risk</Badge>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={() => void handleSaveDraft()} disabled={busy || !pqrId}>
                  <Save className="h-4 w-4 mr-1" />Save as Draft
                </Button>
                <Button onClick={() => void handleSubmit()} disabled={busy || submitting || !canSubmit} className="bg-blue-600 hover:bg-blue-700">
                  <Send className="h-4 w-4 mr-1" />Submit for Review
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="outline" disabled={step <= 1 || busy} onClick={() => setStep((s) => Math.max(1, s - 1))} aria-label="Previous step">
            <ArrowLeft className="h-4 w-4 mr-1" />Back
          </Button>
          {step < 8 && (
            <Button onClick={() => void nextStep()} disabled={busy || (step === 1 && !productId)} aria-label="Next step">
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-1" />}
              {step === 4 ? 'Collect Data' : step === 5 && !collectedData ? 'Collect Data' : step === 6 ? 'Generate Draft' : 'Next'}
            </Button>
          )}
        </div>

        <ConfirmDialog
          open={overrideOpen}
          onOpenChange={setOverrideOpen}
          title="QA Period Override"
          description={overlapWarning || 'An overlapping or active PQR exists. Proceed with QA override?'}
          confirmLabel="Override & Continue"
          onConfirm={async () => {
            await logPqrCreateOverride(actor, overlapWarning || 'period overlap');
            setOverrideOpen(false);
            const ok = await validatePeriod(true);
            if (ok) {
              setStep(3);
              void loadBatches();
              toast.warning('QA override applied');
            }
          }}
        />
      </div>
    </PqrCreateAccessGuard>
  );
}
