'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft, ArrowRight, AlertTriangle, Loader2, Save, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  canCreateForDepartment,
  computeDeviationAutoRules,
  DEVIATION_CATEGORIES,
  DEVIATION_CRITICALITIES,
  DEVIATION_PLANNED_TYPES,
  DEPARTMENTS,
  BATCH_IMPACT_OPTIONS,
  TRI_STATE_IMPACT_OPTIONS,
  YES_NO_OPTIONS,
  type DeviationBatchOption,
  type DeviationProductOption,
} from '@/lib/deviation-create-records';
import {
  deviationCreateSchema,
  deviationStep1Schema,
  deviationStep2Schema,
  deviationStep3Schema,
  deviationStep4Schema,
  deviationStep5Schema,
  type DeviationCreateInput,
} from '@/lib/deviation-schemas';
import {
  fetchDeviationAttachments,
  fetchDeviationBatches,
  fetchDeviationProducts,
  generateDeviationNumberForDepartment,
  logDeviationCreateAudit,
  saveDeviationDraft,
  submitDeviationFromCreate,
  uploadDeviationCreateAttachment,
} from '@/lib/deviation-create-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { DeviationCriticalityBadge } from '@/components/deviations/deviation-sub-nav';
import { RiskBadge } from '@/components/deviations/deviation-risk-badge';
import { DeviationCreateAccessGuard } from './deviation-create-access-guard';
import { DeviationAttachmentUploader, AttachmentList } from './deviation-attachment-uploader';
import { FormSectionCard } from './form-section-card';
import { StepWizard } from './step-wizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DeviationAttachment } from '@/lib/deviation-types';

const STEP_SCHEMAS = [
  deviationStep1Schema,
  deviationStep2Schema,
  deviationStep3Schema,
  deviationStep4Schema,
  deviationStep5Schema,
  deviationCreateSchema,
];

function CreateDeviationInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<DeviationProductOption[]>([]);
  const [batches, setBatches] = useState<DeviationBatchOption[]>([]);
  const [previewNumber, setPreviewNumber] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<DeviationAttachment[]>([]);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: profile?.role,
    email: profile?.email,
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role]);

  const form = useForm<DeviationCreateInput>({
    resolver: zodResolver(deviationCreateSchema),
    defaultValues: {
      deviation_date: new Date().toISOString().split('T')[0],
      deviation_time: new Date().toTimeString().slice(0, 5),
      department: '',
      area: '',
      reported_by_name: profile?.full_name || profile?.email || '',
      detected_by_name: profile?.full_name || profile?.email || '',
      product_name: '',
      product_code: '',
      batch_number: '',
      market: '',
      manufacturing_date: '',
      expiry_date: '',
      planned_type: 'Unplanned',
      category: 'Process',
      criticality: 'Minor',
      title: '',
      description: '',
      immediate_action: '',
      batch_impact: 'No',
      product_quality_impact: 'No',
      patient_safety_impact: 'No',
      regulatory_impact_status: 'No',
      repeat_deviation: 'No',
      previous_deviation_reference: '',
      investigation_required: true,
      capa_required: false,
      assigned_investigator_name: '',
      qa_reviewer_name: '',
      target_closure_date: '',
      qa_remarks: '',
      remarks: '',
      source: searchParams.get('source') || undefined,
      source_reference: searchParams.get('reference') || null,
      cpv_record_id: searchParams.get('cpv_id') || null,
    },
  });

  const watchAll = form.watch();
  const autoRules = useMemo(() => computeDeviationAutoRules(watchAll), [watchAll]);

  useEffect(() => {
    if (autoRules.capaRequired) form.setValue('capa_required', true);
    form.setValue('head_qa_approval_required', autoRules.headQaApprovalRequired);
  }, [autoRules.capaRequired, autoRules.headQaApprovalRequired, form]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) {
        setError('Firebase is not configured. Set environment variables to create deviations.');
        return;
      }
      setProducts(await fetchDeviationProducts());
      const prefillProduct = searchParams.get('product') || '';
      const prefillBatch = searchParams.get('batch') || '';
      if (prefillProduct) form.setValue('product_name', prefillProduct);
      if (prefillBatch) form.setValue('batch_number', prefillBatch);
      if (searchParams.get('title')) form.setValue('title', searchParams.get('title') || '');
      if (searchParams.get('description')) form.setValue('description', searchParams.get('description') || '');
      if (searchParams.get('department')) form.setValue('department', searchParams.get('department') || '');
    } catch {
      setError('Failed to load reference data.');
    } finally {
      setLoading(false);
    }
  }, [form, searchParams]);

  useEffect(() => { void loadInitial(); void logDeviationCreateAudit('Create Page Viewed', actor, 'new'); }, [loadInitial, actor]);

  useEffect(() => {
    const dept = watchAll.department;
    if (!dept) return;
    void generateDeviationNumberForDepartment(dept).then((preview) => {
      setPreviewNumber(preview);
      if (!preview) toast.error('Deviation numbering is not available from backend configuration.');
    });
  }, [watchAll.department]);

  useEffect(() => {
    const product = watchAll.product_name;
    if (!product) { setBatches([]); return; }
    void fetchDeviationBatches(product).then(setBatches);
    const selected = products.find((p) => p.productName === product);
    if (selected) {
      form.setValue('product_code', selected.productCode);
      if (selected.market) form.setValue('market', selected.market);
    }
  }, [watchAll.product_name, products, form]);

  useEffect(() => {
    const batchNo = watchAll.batch_number;
    const batch = batches.find((b) => b.batchNumber === batchNo);
    if (batch) {
      if (batch.manufacturingDate) form.setValue('manufacturing_date', batch.manufacturingDate);
      if (batch.expiryDate) form.setValue('expiry_date', batch.expiryDate);
      if (batch.productCode) form.setValue('product_code', batch.productCode);
    }
  }, [watchAll.batch_number, batches, form]);

  const validateStep = async (s: number) => {
    const schema = STEP_SCHEMAS[s - 1];
    const values = form.getValues();
    const result = schema.safeParse(values);
    if (!result.success) {
      result.error.issues.forEach((issue: { path: (string | number)[]; message: string }) => {
        const path = issue.path[0];
        if (typeof path === 'string') form.setError(path as keyof DeviationCreateInput, { message: issue.message });
      });
      toast.error('Please fix validation errors before continuing.');
      return false;
    }
    const dept = values.department;
    if (s === 1 && dept && !canCreateForDepartment(profile?.role, dept)) {
      toast.error('You can only create deviations for your department.');
      return false;
    }
    return true;
  };

  const ensureDraft = async (): Promise<string | null> => {
    if (draftId) return draftId;
    setBusy(true);
    const { record, error: err } = await saveDeviationDraft(form.getValues(), actor);
    setBusy(false);
    if (err || !record.id) {
      toast.error(err || 'Failed to create draft');
      return null;
    }
    setDraftId(record.id);
    setPreviewNumber(record.deviation_number);
    setAttachments(await fetchDeviationAttachments(record.id));
    return record.id;
  };

  const handleNext = async () => {
    if (!(await validateStep(step))) return;
    if (step === 5) await ensureDraft();
    setStep((s) => Math.min(s + 1, 6));
  };

  const handleSaveDraft = async () => {
    if (!(await validateStep(Math.min(step, 5)))) return;
    setBusy(true);
    const { record, error: err } = await saveDeviationDraft(form.getValues(), actor, draftId);
    setBusy(false);
    if (err) { toast.error(err); return; }
    setDraftId(record.id);
    setPreviewNumber(record.deviation_number);
    toast.success(`Draft saved — ${record.deviation_number}`);
  };

  const handleSubmit = async () => {
    const valid = await form.trigger();
    if (!valid) { toast.error('Please complete all required fields.'); return; }
    setBusy(true);
    const id = draftId || await ensureDraft();
    if (!id) { setBusy(false); return; }
    const { record, error: err } = await submitDeviationFromCreate(id, form.getValues(), actor);
    setBusy(false);
    if (err) { toast.error(err); return; }
    toast.success(`Deviation ${record.deviation_number} submitted`);
    router.push(`/qms/deviation/${record.id}`);
  };

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error) return <ErrorCard title="Unable to load" message={error} onRetry={loadInitial} />;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="Create Deviation"
        description="Record planned or unplanned GMP deviations with impact assessment and workflow routing"
        trail={[
          { label: 'QMS', href: '/qms/deviation' },
          { label: 'Deviation Management', href: '/qms/deviation' },
          { label: 'Create Deviation' },
        ]}
        actions={(
          <Link href="/qms/deviation">
            <Button variant="outline" size="sm"><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>
          </Link>
        )}
      />

      <StepWizard step={step} />

      {(previewNumber || draftId) && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <span className="text-muted-foreground">Deviation Number:</span>
            <span className="font-mono font-semibold text-blue-700">{previewNumber || 'Pending...'}</span>
            {watchAll.criticality && <DeviationCriticalityBadge criticality={watchAll.criticality} />}
            <RiskBadge risk={watchAll.criticality === 'Critical' ? 'critical' : watchAll.criticality === 'Major' ? 'high' : 'medium'} />
          </CardContent>
        </Card>
      )}

      {autoRules.warnings.length > 0 && (
        <div className="space-y-2">
          {autoRules.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      <Form {...form}>
        <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          {step === 1 && (
            <FormSectionCard title="Basic Information" description="When and where the deviation was identified">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField control={form.control} name="deviation_date" render={({ field }) => (
                  <FormItem><FormLabel>Deviation Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="deviation_time" render={({ field }) => (
                  <FormItem><FormLabel>Deviation Time</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="department" render={({ field }) => (
                  <FormItem><FormLabel>Department *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger></FormControl>
                      <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="area" render={({ field }) => (
                  <FormItem><FormLabel>Area / Location *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="reported_by_name" render={({ field }) => (
                  <FormItem><FormLabel>Reported By *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="detected_by_name" render={({ field }) => (
                  <FormItem><FormLabel>Detected By *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </FormSectionCard>
          )}

          {step === 2 && (
            <FormSectionCard title="Product & Batch Details" description="Link deviation to product and batch records">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField control={form.control} name="product_name" render={({ field }) => (
                  <FormItem><FormLabel>Product *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {products.map((p) => <SelectItem key={p.id} value={p.productName}>{p.productName}</SelectItem>)}
                        {!products.length && <SelectItem value={field.value || 'Manual Entry'}>{field.value || 'Enter manually below'}</SelectItem>}
                      </SelectContent>
                    </Select>
                    {!products.length && <FormControl><Input className="mt-2" placeholder="Product name" {...field} /></FormControl>}
                    <FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="product_code" render={({ field }) => (
                  <FormItem><FormLabel>Product Code</FormLabel><FormControl><Input {...field} readOnly className="bg-muted/50" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="batch_number" render={({ field }) => (
                  <FormItem><FormLabel>Batch Number</FormLabel>
                    <Select onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)} value={field.value || '__none__'}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select batch (optional)" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {batches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}
                      </SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="market" render={({ field }) => (
                  <FormItem><FormLabel>Market</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="manufacturing_date" render={({ field }) => (
                  <FormItem><FormLabel>Manufacturing Date</FormLabel><FormControl><Input type="month" {...field} value={(field.value || '').slice(0, 7)} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="expiry_date" render={({ field }) => (
                  <FormItem><FormLabel>Expiry Date</FormLabel><FormControl><Input type="month" {...field} value={(field.value || '').slice(0, 7)} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              {watchAll.batch_number && (
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Batch linked — PQR/CPV references will be attached on save.
                </div>
              )}
            </FormSectionCard>
          )}

          {step === 3 && (
            <FormSectionCard title="Deviation Details" description="Classification and narrative of the event">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField control={form.control} name="planned_type" render={({ field }) => (
                  <FormItem><FormLabel>Deviation Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{DEVIATION_PLANNED_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem><FormLabel>Category *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{DEVIATION_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="criticality" render={({ field }) => (
                  <FormItem><FormLabel>Criticality *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{DEVIATION_CRITICALITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem><FormLabel>Title *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description *</FormLabel><FormControl><Textarea rows={4} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="immediate_action" render={({ field }) => (
                <FormItem><FormLabel>Immediate Action Taken *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </FormSectionCard>
          )}

          {step === 4 && (
            <FormSectionCard title="Impact Assessment Quick Check" description="Initial impact evaluation drives CAPA and approval routing">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {([
                  ['batch_impact', 'Batch Impact', BATCH_IMPACT_OPTIONS],
                  ['product_quality_impact', 'Product Quality Impact', TRI_STATE_IMPACT_OPTIONS],
                  ['patient_safety_impact', 'Patient Safety Impact', TRI_STATE_IMPACT_OPTIONS],
                  ['regulatory_impact_status', 'Regulatory Impact', TRI_STATE_IMPACT_OPTIONS],
                  ['repeat_deviation', 'Repeat Deviation', YES_NO_OPTIONS],
                ] as const).map(([name, label, options]) => (
                  <FormField key={name} control={form.control} name={name} render={({ field }) => (
                    <FormItem><FormLabel>{label}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                ))}
                <FormField control={form.control} name="previous_deviation_reference" render={({ field }) => (
                  <FormItem className="md:col-span-2"><FormLabel>Previous Deviation Reference</FormLabel><FormControl><Input {...field} placeholder="DEV/QA/2025/0012" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </FormSectionCard>
          )}

          {step === 5 && (
            <FormSectionCard title="Assignment & Closure" description="Investigation ownership and target dates">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField control={form.control} name="investigation_required" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel>Investigation Required</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="capa_required" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel>CAPA Required {autoRules.capaRequired && '(Auto)'}</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={autoRules.capaRequired} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="assigned_investigator_name" render={({ field }) => (
                  <FormItem><FormLabel>Assigned Investigator {watchAll.investigation_required ? '*' : ''}</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="qa_reviewer_name" render={({ field }) => (
                  <FormItem><FormLabel>QA Reviewer</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="target_closure_date" render={({ field }) => (
                  <FormItem><FormLabel>Target Closure Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </FormSectionCard>
          )}

          {step === 6 && (
            <FormSectionCard title="Attachments & Submit" description="Upload evidence and submit for QA review">
              {!draftId ? (
                <p className="text-sm text-muted-foreground">Save draft first to enable attachment uploads.</p>
              ) : (
                <>
                  <DeviationAttachmentUploader
                    disabled={busy}
                    onUpload={async (file) => {
                      const { attachment, error: err } = await uploadDeviationCreateAttachment(draftId, file, actor);
                      if (attachment) setAttachments((prev) => [...prev, attachment]);
                      return { error: err };
                    }}
                  />
                  <AttachmentList files={attachments} />
                </>
              )}
              <FormField control={form.control} name="remarks" render={({ field }) => (
                <FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </FormSectionCard>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="flex gap-2">
              {step > 1 && (
                <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                  <ArrowLeft className="mr-1 h-4 w-4" />Previous
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                Save Draft
              </Button>
              {step < 6 ? (
                <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={handleNext} disabled={busy}>
                  Next<ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={handleSubmit} disabled={busy}>
                  {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                  Submit Deviation
                </Button>
              )}
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}

export function CreateDeviationPage() {
  return (
    <DeviationCreateAccessGuard>
      <Suspense fallback={<LoadingSkeleton rows={2} />}>
        <CreateDeviationInner />
      </Suspense>
    </DeviationCreateAccessGuard>
  );
}
