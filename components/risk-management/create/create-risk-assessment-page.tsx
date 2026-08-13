'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Loader2, Save, Search, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  computeRiskCreateAutoRules,
  RISK_CREATE_WIZARD_STEPS,
  sourceNeedsReference,
} from '@/lib/risk-create-records';
import {
  riskCreateSchema,
  validateRiskCreateStep,
  RISK_CREATE_SOURCES,
  RISK_CREATE_CATEGORIES,
  REVIEW_FREQUENCIES,
  type RiskCreateInput,
} from '@/lib/risk-create-schemas';
import {
  fetchRiskCreateBatches,
  fetchRiskCreateDepartments,
  fetchRiskCreateOwners,
  fetchRiskCreateProducts,
  generateRiskNumberPreview,
  lookupRiskSourceReference,
  saveRiskAssessmentDraft,
  submitRiskAssessmentCreate,
} from '@/lib/risk-create-service';
import { buildRiskAssessmentMatrix, calculateRiskAssessment } from '@/lib/cpv-risk-assessment-records';
import type { RiskAssessmentRecord } from '@/lib/cpv-risk-assessment-records';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { RiskMatrix } from '@/components/cpv/risk-assessment/risk-matrix';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { RiskCreateAccessGuard } from './risk-create-access-guard';
import { RiskCreateWizard } from './risk-create-wizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function ScoreSelect({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RiskLevelBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-100 text-red-800 border-red-300'
    : level === 'High' ? 'bg-orange-100 text-orange-800 border-orange-300'
      : level === 'Medium' ? 'bg-amber-100 text-amber-800 border-amber-300'
        : 'bg-green-100 text-green-800 border-green-300';
  return <span className={`rounded-md border px-2 py-1 text-sm font-medium ${cls}`}>{level}</span>;
}

export function CreateRiskAssessmentPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <CreateRiskAssessmentInner />
    </Suspense>
  );
}

function CreateRiskAssessmentInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [previewNumber, setPreviewNumber] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [products, setProducts] = useState<Awaited<ReturnType<typeof fetchRiskCreateProducts>>>([]);
  const [batches, setBatches] = useState<Awaited<ReturnType<typeof fetchRiskCreateBatches>>>([]);
  const [departments, setDepartments] = useState<Awaited<ReturnType<typeof fetchRiskCreateDepartments>>>([]);
  const [owners, setOwners] = useState<Awaited<ReturnType<typeof fetchRiskCreateOwners>>>([]);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: profile?.role || '',
    department: profile?.department || '',
    email: profile?.email,
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role, profile?.department]);

  const form = useForm<RiskCreateInput>({
    resolver: zodResolver(riskCreateSchema),
    defaultValues: {
      risk_date: new Date().toISOString().split('T')[0],
      risk_title: '',
      risk_source: (searchParams.get('source') as RiskCreateInput['risk_source']) || 'Manual',
      source_reference_number: searchParams.get('ref') || '',
      department: profile?.department || 'QA',
      product_name: '',
      product_code: '',
      batch_number: '',
      risk_category: 'Process Risk',
      process_area: '',
      risk_description: '',
      potential_failure_mode: '',
      potential_impact: '',
      potential_cause: '',
      existing_controls: '',
      severity_score: 5,
      occurrence_score: 4,
      detection_score: 5,
      risk_owner: user?.uid || '',
      risk_owner_name: profile?.full_name || '',
      mitigation_plan: '',
      target_completion_date: '',
      review_frequency: 'Annual',
      residual_severity: 4,
      residual_occurrence: 3,
      residual_detection: 4,
      remarks: '',
    },
  });

  const watchSource = form.watch('risk_source');
  const watchProduct = form.watch('product_name');
  const watchSeverity = form.watch('severity_score');
  const watchOccurrence = form.watch('occurrence_score');
  const watchDetection = form.watch('detection_score');
  const watchCategory = form.watch('risk_category');
  const watchResidualSev = form.watch('residual_severity');
  const watchResidualOcc = form.watch('residual_occurrence');
  const watchResidualDet = form.watch('residual_detection');

  const autoRules = useMemo(() => computeRiskCreateAutoRules({
    severity: Number(watchSeverity),
    occurrence: Number(watchOccurrence),
    detection: Number(watchDetection),
    risk_category: watchCategory,
    residual_severity: Number(watchResidualSev),
    residual_occurrence: Number(watchResidualOcc),
    residual_detection: Number(watchResidualDet),
  }), [watchSeverity, watchOccurrence, watchDetection, watchCategory, watchResidualSev, watchResidualOcc, watchResidualDet]);

  const previewRecord = useMemo((): RiskAssessmentRecord => {
    const calc = calculateRiskAssessment(
      Number(watchSeverity),
      Number(watchOccurrence),
      Number(watchDetection),
      {
        severity: Number(watchResidualSev),
        occurrence: Number(watchResidualOcc),
        detection: Number(watchResidualDet),
      },
    );
    return {
      id: 'preview',
      riskAssessmentId: 'preview',
      riskNumber: previewNumber || 'RISK/XXXX/0001',
      cpvProductId: '',
      productName: form.getValues('product_name'),
      productCode: form.getValues('product_code'),
      productVersion: '',
      batchNumber: form.getValues('batch_number'),
      title: form.getValues('risk_title') || '',
      methodology: 'FMEA',
      riskCategory: form.getValues('risk_category') as RiskAssessmentRecord['riskCategory'],
      riskSource: 'Manual Assessment',
      processStage: form.getValues('process_area'),
      process: '',
      processStep: '',
      department: '',
      site: '',
      equipmentId: '',
      equipmentName: '',
      machine: '',
      material: '',
      supplier: '',
      utility: '',
      environmentalCondition: '',
      parameterType: 'CPP',
      parameterName: form.getValues('risk_title'),
      riskDescription: form.getValues('risk_description'),
      potentialImpact: form.getValues('potential_impact'),
      potentialCause: form.getValues('potential_cause'),
      existingControls: form.getValues('existing_controls'),
      severityScore: Number(watchSeverity),
      occurrenceScore: Number(watchOccurrence),
      detectionScore: Number(watchDetection),
      residualSeverity: Number(watchResidualSev),
      residualOccurrence: Number(watchResidualOcc),
      residualDetection: Number(watchResidualDet),
      rpnScore: calc.rpnScore || autoRules.rpn,
      riskLevel: calc.riskLevel || autoRules.risk_level,
      residualRpn: calc.residualRpn,
      residualRiskLevel: calc.residualRiskLevel,
      riskReductionPercent: calc.riskReductionPercent,
      criticality: calc.criticality,
      probability: calc.probability,
      impact: calc.impact,
      likelihood: calc.likelihood,
      healthScore: calc.healthScore,
      confidenceScore: calc.confidenceScore,
      aiRecommendation: calc.aiRecommendation,
      repeatedRiskDetected: false,
      missingControls: !form.getValues('existing_controls'),
      mitigationOverdue: false,
      riskStatus: 'Draft',
      workflowStatus: 'Draft',
      effectivenessStatus: 'Pending',
      riskOwner: form.getValues('risk_owner_name') || form.getValues('risk_owner'),
      mitigationAction: form.getValues('mitigation_plan'),
      targetCompletionDate: form.getValues('target_completion_date'),
      assessmentDate: '',
      reviewFrequency: '',
      priority: '',
      version: '1.0',
      effectivenessCheckRequired: true,
      linkedCapaNumber: '',
      linkedDeviationNumber: '',
      linkedOosNumber: '',
      linkedChangeControlNumber: '',
      capaSuggested: calc.capaSuggested || autoRules.mitigation_required,
      deviationRequired: calc.deviationRequired,
      changeReason: 'Preview only',
      isAutoGenerated: false,
      isLocked: false,
      reviewedBy: '',
      reviewDate: '',
      approvedBy: '',
      approvalDate: '',
      closedBy: '',
      closedDate: '',
      controls: [],
      reviews: [],
      remarks: form.getValues('remarks'),
      createdAt: '',
      updatedAt: '',
      createdBy: '',
      updatedBy: '',
      isDeleted: false,
    };
  }, [previewNumber, form, watchSeverity, watchOccurrence, watchDetection, watchResidualSev, watchResidualOcc, watchResidualDet, autoRules]);

  const matrix = useMemo(() => buildRiskAssessmentMatrix([previewRecord]), [previewRecord]);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, depts, ownerList, num] = await Promise.all([
        fetchRiskCreateProducts(),
        fetchRiskCreateDepartments(),
        fetchRiskCreateOwners(),
        generateRiskNumberPreview(),
      ]);
      setProducts(prods);
      setDepartments(depts);
      setOwners(ownerList);
      setPreviewNumber(num);
      if (!num) {
        toast.error('Risk numbering backend configuration is not available.');
      }
    } catch {
      toast.error('Failed to load form options');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  useEffect(() => {
    const loadBatches = async () => {
      const list = await fetchRiskCreateBatches(watchProduct || undefined);
      setBatches(list);
    };
    void loadBatches();
  }, [watchProduct]);

  useEffect(() => {
    form.setValue('mitigation_required', autoRules.mitigation_required);
  }, [autoRules.mitigation_required, form]);

  const validateStep = async () => {
    const values = form.getValues();
    const result = validateRiskCreateStep(step, values);
    if (!result.success) {
      result.issues.forEach((issue) => {
        const path = issue.path.join('.') as FieldPath<RiskCreateInput>;
        if (path) form.setError(path, { message: issue.message });
      });
      return false;
    }
    return true;
  };

  const handleNext = async () => {
    const ok = await validateStep();
    if (!ok) {
      toast.error('Please complete required fields before continuing.');
      return;
    }
    setStep((s) => Math.min(s + 1, RISK_CREATE_WIZARD_STEPS.length));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  useEffect(() => {
    const source = searchParams.get('source');
    const ref = searchParams.get('ref');
    if (!ref?.trim() || !source || source === 'Manual') return;
    const run = async () => {
      setLookupBusy(true);
      try {
        const result = await lookupRiskSourceReference(source, ref);
        if (!result.found) return;
        if (result.risk_title) form.setValue('risk_title', result.risk_title);
        if (result.risk_description) form.setValue('risk_description', result.risk_description);
        if (result.potential_impact) form.setValue('potential_impact', result.potential_impact);
        if (result.potential_cause) form.setValue('potential_cause', result.potential_cause);
        if (result.potential_failure_mode) form.setValue('potential_failure_mode', result.potential_failure_mode);
        if (result.product_name) form.setValue('product_name', result.product_name);
        if (result.product_code) form.setValue('product_code', result.product_code);
        if (result.batch_number) form.setValue('batch_number', result.batch_number);
        if (result.department) form.setValue('department', result.department);
        if (result.process_area) form.setValue('process_area', result.process_area);
        if (result.risk_category) form.setValue('risk_category', result.risk_category as RiskCreateInput['risk_category']);
      } finally {
        setLookupBusy(false);
      }
    };
    void run();
  }, [searchParams, form]);

  const handleLookup = async () => {
    const ref = form.getValues('source_reference_number');
    if (!ref.trim()) {
      toast.error('Enter a source reference number');
      return;
    }
    setLookupBusy(true);
    try {
      const result = await lookupRiskSourceReference(watchSource, ref);
      if (!result.found) {
        toast.error(result.message || 'Source record not found');
        return;
      }
      if (result.risk_title) form.setValue('risk_title', result.risk_title);
      if (result.risk_description) form.setValue('risk_description', result.risk_description);
      if (result.potential_impact) form.setValue('potential_impact', result.potential_impact);
      if (result.potential_cause) form.setValue('potential_cause', result.potential_cause);
      if (result.potential_failure_mode) form.setValue('potential_failure_mode', result.potential_failure_mode);
      if (result.product_name) form.setValue('product_name', result.product_name);
      if (result.product_code) form.setValue('product_code', result.product_code);
      if (result.batch_number) form.setValue('batch_number', result.batch_number);
      if (result.department) form.setValue('department', result.department);
      if (result.process_area) form.setValue('process_area', result.process_area);
      if (result.risk_category) form.setValue('risk_category', result.risk_category as RiskCreateInput['risk_category']);
      toast.success('Source details loaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setLookupBusy(false);
    }
  };

  const handleSaveDraft = async () => {
    setBusy(true);
    try {
      const values = form.getValues();
      const saved = await saveRiskAssessmentDraft(values, actor, draftId);
      setDraftId(saved.id);
      setPreviewNumber(saved.riskNumber);
      toast.success('Risk assessment draft saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = form.handleSubmit(async (values: RiskCreateInput) => {
    setBusy(true);
    try {
      const saved = await submitRiskAssessmentCreate(values, actor, draftId);
      toast.success(`Risk ${saved.riskNumber} submitted for review`);
      router.push(`/cpv/risk-assessment/${saved.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  });

  if (loading) return <LoadingSkeleton rows={4} />;

  return (
    <RiskCreateAccessGuard>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <Link href="/qms/risk-management/dashboard">
            <Button variant="ghost" size="sm" className="gap-1 mt-1"><ArrowLeft className="h-4 w-4" />Back</Button>
          </Link>
          <div className="flex-1">
            <CpvPageHeader
              title="Create Risk Assessment"
              description="Create and score GMP quality risks using ICH Q9 principles"
              trail={[
                { label: 'Dashboard', href: '/dashboard' },
                { label: 'QMS', href: '/qms/risk-management' },
                { label: 'Risk Management', href: '/qms/risk-management/dashboard' },
                { label: 'Create Risk Assessment' },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Risk Number (preview):</span>
          <span className="font-mono font-medium text-blue-700">{previewNumber || '—'}</span>
          <RiskLevelBadge level={autoRules.risk_level} />
          <span className="text-muted-foreground">RPN: <strong>{autoRules.rpn}</strong></span>
        </div>

        <RiskCreateWizard step={step} />

        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {step === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Source & Identification</CardTitle>
                  <CardDescription>Define risk source, title, and owning department.</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="risk_date" render={({ field }) => (
                    <FormItem><FormLabel>Risk Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="risk_title" render={({ field }) => (
                    <FormItem><FormLabel>Risk Title</FormLabel><FormControl><Input {...field} placeholder="Brief risk title" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="risk_source" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Risk Source</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {RISK_CREATE_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="department" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {departments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  {sourceNeedsReference(watchSource) ? (
                    <div className="sm:col-span-2 flex gap-2 items-end">
                      <FormField control={form.control} name="source_reference_number" render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormLabel>Source Reference Number</FormLabel>
                          <FormControl><Input {...field} placeholder={`${watchSource} reference`} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button type="button" variant="outline" onClick={() => void handleLookup()} disabled={lookupBusy}>
                        {lookupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        <span className="ml-1 hidden sm:inline">Lookup</span>
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Product & Risk Context</CardTitle>
                  <CardDescription>Link product, batch, and risk category.</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="product_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product</FormLabel>
                      <Select value={field.value || '__none__'} onValueChange={(v) => {
                        const val = v === '__none__' ? '' : v;
                        field.onChange(val);
                        const prod = products.find((p) => p.name === val);
                        if (prod?.code) form.setValue('product_code', prod.code);
                      }}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          {products.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="batch_number" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Batch Number</FormLabel>
                      <Select value={field.value || '__none__'} onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          {batches.map((b) => <SelectItem key={b.id} value={b.batch_number}>{b.batch_number}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="risk_category" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Risk Category</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {RISK_CREATE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="process_area" render={({ field }) => (
                    <FormItem><FormLabel>Process / Area</FormLabel><FormControl><Input {...field} placeholder="e.g. Granulation, Packaging" /></FormControl></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Risk Description & Scoring</CardTitle>
                    <CardDescription>Describe the risk and assign Severity, Occurrence, Detection scores (1–10).</CardDescription>
                  </CardHeader>
                  <CardContent className="grid sm:grid-cols-2 gap-4">
                    <FormField control={form.control} name="risk_description" render={({ field }) => (
                      <FormItem className="sm:col-span-2"><FormLabel>Risk Description</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="potential_failure_mode" render={({ field }) => (
                      <FormItem><FormLabel>Potential Failure Mode</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="potential_impact" render={({ field }) => (
                      <FormItem><FormLabel>Potential Impact</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="potential_cause" render={({ field }) => (
                      <FormItem><FormLabel>Potential Cause</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="existing_controls" render={({ field }) => (
                      <FormItem><FormLabel>Existing Controls</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="risk_owner" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Risk Owner</FormLabel>
                        <Select value={field.value} onValueChange={(v) => {
                          field.onChange(v);
                          const owner = owners.find((o) => o.id === v);
                          if (owner) form.setValue('risk_owner_name', owner.name);
                        }}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="severity_score" render={({ field }) => (
                      <FormItem><FormLabel>Severity (1–10)</FormLabel><FormControl><ScoreSelect value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="occurrence_score" render={({ field }) => (
                      <FormItem><FormLabel>Occurrence (1–10)</FormLabel><FormControl><ScoreSelect value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="detection_score" render={({ field }) => (
                      <FormItem><FormLabel>Detection (1–10)</FormLabel><FormControl><ScoreSelect value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">RPN Calculator & Risk Matrix Preview</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-4 items-center">
                      <div className="rounded-lg border p-4 text-center min-w-[120px]">
                        <p className="text-xs text-muted-foreground">RPN</p>
                        <p className="text-2xl font-bold tabular-nums">{autoRules.rpn}</p>
                      </div>
                      <RiskLevelBadge level={autoRules.risk_level} />
                      {autoRules.mitigation_required ? (
                        <Alert className="flex-1 border-amber-200 bg-amber-50">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Mitigation Required</AlertTitle>
                          <AlertDescription>High/Critical risk — mitigation plan mandatory on next step.</AlertDescription>
                        </Alert>
                      ) : null}
                    </div>
                    <RiskMatrix matrix={matrix} />
                  </CardContent>
                </Card>
              </div>
            )}

            {step === 4 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Mitigation & Residual Risk</CardTitle>
                  <CardDescription>Define controls and evaluate residual risk after mitigation.</CardDescription>
                </CardHeader>
                <CardContent className="grid sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="mitigation_plan" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Mitigation Plan {autoRules.mitigation_required ? '(Required)' : ''}</FormLabel>
                      <FormControl><Textarea rows={3} {...field} placeholder="Planned mitigation actions" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="target_completion_date" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Completion Date {autoRules.mitigation_required ? '(Required)' : ''}</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="review_frequency" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Review Frequency</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {REVIEW_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="residual_severity" render={({ field }) => (
                    <FormItem><FormLabel>Residual Severity</FormLabel><FormControl><ScoreSelect value={field.value} onChange={field.onChange} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="residual_occurrence" render={({ field }) => (
                    <FormItem><FormLabel>Residual Occurrence</FormLabel><FormControl><ScoreSelect value={field.value} onChange={field.onChange} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="residual_detection" render={({ field }) => (
                    <FormItem><FormLabel>Residual Detection</FormLabel><FormControl><ScoreSelect value={field.value} onChange={field.onChange} /></FormControl></FormItem>
                  )} />
                  <div className="sm:col-span-2 flex flex-wrap gap-4 items-center rounded-lg border p-4 bg-slate-50">
                    <div><p className="text-xs text-muted-foreground">Residual RPN</p><p className="text-xl font-bold">{autoRules.residual_rpn}</p></div>
                    <RiskLevelBadge level={autoRules.residual_risk_level} />
                  </div>
                  <FormField control={form.control} name="remarks" render={({ field }) => (
                    <FormItem className="sm:col-span-2"><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 5 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Review & Submit</CardTitle>
                  <CardDescription>Confirm details before saving draft or submitting for QA review.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <p><span className="text-muted-foreground">Risk Number:</span> <strong className="font-mono">{previewNumber}</strong></p>
                    <p><span className="text-muted-foreground">Risk Title:</span> {form.getValues('risk_title')}</p>
                    <p><span className="text-muted-foreground">Source:</span> {form.getValues('risk_source')}</p>
                    <p><span className="text-muted-foreground">Department:</span> {form.getValues('department')}</p>
                    <p><span className="text-muted-foreground">Category:</span> {form.getValues('risk_category')}</p>
                    <p><span className="text-muted-foreground">Product:</span> {form.getValues('product_name') || '—'}</p>
                    <p><span className="text-muted-foreground">RPN / Level:</span> {autoRules.rpn} / {autoRules.risk_level}</p>
                    <p><span className="text-muted-foreground">Residual RPN:</span> {autoRules.residual_rpn} / {autoRules.residual_risk_level}</p>
                    <p><span className="text-muted-foreground">Risk Owner:</span> {form.getValues('risk_owner_name') || form.getValues('risk_owner')}</p>
                    <p><span className="text-muted-foreground">Mitigation Required:</span> {autoRules.mitigation_required ? 'Yes' : 'No'}</p>
                  </div>
                  {(autoRules.notify_head_qa || autoRules.notify_csv || autoRules.notify_regulatory) ? (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Notifications will be sent</AlertTitle>
                      <AlertDescription>
                        {[
                          autoRules.notify_head_qa ? 'Head QA' : '',
                          autoRules.notify_csv ? 'CSV Team' : '',
                          autoRules.notify_regulatory ? 'Regulatory Team' : '',
                        ].filter(Boolean).join(', ')} will be notified on submit.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap gap-2 justify-between pt-2">
              <div className="flex gap-2">
                {step > 1 ? (
                  <Button type="button" variant="outline" onClick={handleBack} disabled={busy}>
                    <ArrowLeft className="h-4 w-4 mr-1" />Back
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void handleSaveDraft()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Save Draft
                </Button>
                {step < RISK_CREATE_WIZARD_STEPS.length ? (
                  <Button type="button" onClick={() => void handleNext()} disabled={busy}>
                    Next<ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                    Submit for Review
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </div>
    </RiskCreateAccessGuard>
  );
}
