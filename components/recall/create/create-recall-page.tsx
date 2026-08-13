'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Paperclip, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { ZodIssue } from 'zod';
import { useAuth } from '@/contexts/auth-context';
import {
  RECALL_WIZARD_STEPS,
  canEditRecallDistributionSection,
  canEditRecallRegulatorySection,
  computeRecallAutoRules,
  computeRecoveryPreview,
  defaultNotificationDueDate,
  defaultRecallDueDate,
  mapBatchToForm,
  mapSourceToForm,
} from '@/lib/recall-create-records';
import {
  recallCreateSchema,
  recallDraftSchema,
  recallStep1Schema,
  recallStep2Schema,
  recallStep3Schema,
  recallStep4Schema,
  recallStep5Schema,
  RECALL_TYPES,
  RECALL_CLASSIFICATIONS,
  RECALL_SOURCES,
  type RecallCreateInput,
} from '@/lib/recall-schemas';
import {
  fetchRecallBatchOptions,
  fetchRecallCapaOptions,
  fetchRecallOwnerOptions,
  fetchRecallProductOptions,
  fetchRecallSourceOptions,
  initiateRecallCreate,
  previewRecallNumber,
  saveRecallDraft,
  uploadRecallCreateAttachmentPlaceholder,
} from '@/lib/recall-create-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { RecallCreateAccessGuard } from './recall-create-access-guard';
import { RecallCreateWizard } from './recall-create-wizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STEP_SCHEMAS = [recallStep1Schema, recallStep2Schema, recallStep3Schema, recallStep4Schema, recallStep5Schema, recallCreateSchema];

export function CreateRecallPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <CreateRecallInner />
    </Suspense>
  );
}

function CreateRecallInner() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canRegulatory = canEditRecallRegulatorySection(role);
  const canDistribution = canEditRecallDistributionSection(role);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previewNumber, setPreviewNumber] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [products, setProducts] = useState<Awaited<ReturnType<typeof fetchRecallProductOptions>>>([]);
  const [batches, setBatches] = useState<Awaited<ReturnType<typeof fetchRecallBatchOptions>>>([]);
  const [sources, setSources] = useState<Awaited<ReturnType<typeof fetchRecallSourceOptions>>>([]);
  const [capas, setCapas] = useState<Awaited<ReturnType<typeof fetchRecallCapaOptions>>>([]);
  const [owners, setOwners] = useState<Awaited<ReturnType<typeof fetchRecallOwnerOptions>>>([]);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: role || '',
    department: profile?.department || '',
  }), [user?.uid, profile?.full_name, profile?.email, role, profile?.department]);

  const form = useForm<RecallCreateInput>({
    resolver: zodResolver(recallCreateSchema),
    defaultValues: {
      recall_date: new Date().toISOString().split('T')[0],
      recall_type: 'Voluntary',
      recall_classification: 'Class II',
      recall_source: 'Internal Quality Review',
      source_reference_id: null,
      source_reference_number: '',
      recall_initiated_by_name: profile?.full_name || '',
      product_name: '',
      product_code: '',
      batch_number: '',
      mfg_date: '',
      exp_date: '',
      market_region: 'Domestic',
      customer_name: '',
      reason_for_recall: '',
      recall_justification: '',
      impact_assessment: '',
      risk_assessment: '',
      stock_quantity: 0,
      distributed_quantity: 0,
      recovered_quantity: 0,
      regulatory_notification_required: false,
      regulatory_authority: '',
      notification_due_date: null,
      capa_required: false,
      linked_capa_id: null,
      linked_capa_number: '',
      linked_complaint_id: null,
      linked_deviation_id: null,
      linked_oos_id: null,
      assigned_owner: '',
      assigned_owner_name: profile?.full_name || '',
      due_date: defaultRecallDueDate(new Date().toISOString().split('T')[0]),
      qa_remarks: '',
      include_in_pqr_review: true,
    },
  });

  const watchValues = form.watch();
  const autoRules = useMemo(() => computeRecallAutoRules(watchValues), [watchValues]);
  const recoveryPreview = computeRecoveryPreview(watchValues.distributed_quantity, watchValues.recovered_quantity);

  const loadLookups = useCallback(async () => {
    setLoading(true);
    try {
      const [num, prods, caps, own] = await Promise.all([
        previewRecallNumber(),
        fetchRecallProductOptions(),
        fetchRecallCapaOptions(),
        fetchRecallOwnerOptions(),
      ]);
      setPreviewNumber(num);
      setProducts(prods);
      setCapas(caps);
      setOwners(own);
      if (!num) {
        toast.error('Recall numbering backend configuration is not available.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLookups(); }, [loadLookups]);

  useEffect(() => {
    void fetchRecallBatchOptions(watchValues.product_name).then(setBatches);
  }, [watchValues.product_name]);

  useEffect(() => {
    if (['Complaint', 'Deviation', 'OOS'].includes(watchValues.recall_source)) {
      void fetchRecallSourceOptions(watchValues.recall_source).then(setSources);
    } else {
      setSources([]);
    }
  }, [watchValues.recall_source]);

  useEffect(() => {
    if (watchValues.regulatory_notification_required && !watchValues.notification_due_date) {
      form.setValue('notification_due_date', defaultNotificationDueDate(watchValues.recall_date));
    }
  }, [watchValues.regulatory_notification_required, watchValues.recall_date, watchValues.notification_due_date, form]);

  const validateStep = async () => {
    const schema = STEP_SCHEMAS[step - 1];
    const values = form.getValues();
    const result = schema.safeParse(values);
    if (!result.success) {
      result.error.issues.forEach((issue: ZodIssue) => {
        const path = issue.path[0];
        if (typeof path === 'string') form.setError(path as keyof RecallCreateInput, { message: issue.message });
      });
      toast.error('Please fix validation errors before continuing');
      return false;
    }
    return true;
  };

  const handleNext = async () => {
    if (!(await validateStep())) return;
    setStep((s) => Math.min(s + 1, RECALL_WIZARD_STEPS.length));
  };

  const handleSaveDraft = async () => {
    const draftResult = recallDraftSchema.safeParse(form.getValues());
    if (!draftResult.success) {
      toast.error('Complete required fields before saving draft');
      return;
    }
    setBusy(true);
    const { record, error } = await saveRecallDraft(draftResult.data, actor, draftId);
    setBusy(false);
    if (error || !record) return toast.error(error || 'Failed to save draft');
    setDraftId(record.id);
    toast.success(`Draft saved — ${record.recall_number}`);
  };

  const handleInitiate = async () => {
    const result = recallCreateSchema.safeParse(form.getValues());
    if (!result.success) {
      result.error.issues.forEach((issue: ZodIssue) => {
        const path = issue.path[0];
        if (typeof path === 'string') form.setError(path as keyof RecallCreateInput, { message: issue.message });
      });
      toast.error('Please complete all required fields');
      return;
    }
    setBusy(true);
    const { record, error } = await initiateRecallCreate(result.data, actor, draftId);
    setBusy(false);
    if (error || !record) return toast.error(error || 'Failed to initiate recall');
    toast.success(`Recall ${record.recall_number} initiated`);
    router.push(`/qms/recall/${record.id}`);
  };

  const handleAttachmentPlaceholder = async () => {
    if (!draftId) {
      toast.error('Save draft first to attach files');
      return;
    }
    try {
      await uploadRecallCreateAttachmentPlaceholder(draftId, 'recall-initiation-document.pdf', actor);
      toast.success('Attachment uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Attachment upload failed');
    }
  };

  if (loading) return <LoadingSkeleton rows={4} />;

  return (
    <RecallCreateAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Create Product Recall"
          description="Initiate and control product recall with recovery and regulatory tracking"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/recall' },
            { label: 'Product Recall', href: '/qms/recall' },
            { label: 'Create Recall' },
          ]}
        />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recall Number Preview</CardTitle>
            <CardDescription>Auto-generated on save: <span className="font-mono font-semibold text-blue-700">{previewNumber || 'Number not available from backend'}</span></CardDescription>
          </CardHeader>
        </Card>

        {(autoRules.notify_head_qa || autoRules.create_regulatory_task) && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Auto Rules Active</AlertTitle>
            <AlertDescription>
              {autoRules.notify_head_qa && 'Class I recall — Head QA and Regulatory will be notified immediately. '}
              {autoRules.create_regulatory_task && 'Regulatory notification task will be created. '}
              Recall will appear in PQR Recall Review.
            </AlertDescription>
          </Alert>
        )}

        <RecallCreateWizard step={step} />

        <Form {...form}>
          <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
            {step === 1 && (
              <Card><CardHeader><CardTitle>Step 1 — Recall Initiation</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <FormField control={form.control} name="recall_date" render={({ field }) => (<FormItem><FormLabel>Recall Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="recall_type" render={({ field }) => (<FormItem><FormLabel>Recall Type *</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{RECALL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="recall_classification" render={({ field }) => (<FormItem><FormLabel>Classification *</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{RECALL_CLASSIFICATIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="recall_source" render={({ field }) => (<FormItem><FormLabel>Recall Source</FormLabel><Select onValueChange={(v) => { field.onChange(v); form.setValue('source_reference_id', null); form.setValue('source_reference_number', ''); }} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent>{RECALL_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                {['Complaint', 'Deviation', 'OOS'].includes(watchValues.recall_source) && (
                  <FormField control={form.control} name="source_reference_id" render={({ field }) => (<FormItem className="sm:col-span-2"><FormLabel>Source Reference</FormLabel><Select value={field.value || ''} onValueChange={(v) => { field.onChange(v); const src = sources.find((s) => s.id === v); if (src) form.reset({ ...form.getValues(), ...mapSourceToForm(src), source_reference_id: v }); }}><FormControl><SelectTrigger><SelectValue placeholder="Select source record..." /></SelectTrigger></FormControl><SelectContent>{sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                )}
                <FormField control={form.control} name="source_reference_number" render={({ field }) => (<FormItem><FormLabel>Reference Number</FormLabel><FormControl><Input {...field} placeholder="CMP/2026/0001" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="recall_initiated_by_name" render={({ field }) => (<FormItem><FormLabel>Initiated By *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              </CardContent></Card>
            )}

            {step === 2 && (
              <Card><CardHeader><CardTitle>Step 2 — Product & Batch</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <FormField control={form.control} name="product_name" render={({ field }) => (<FormItem className="sm:col-span-2"><FormLabel>Product *</FormLabel><Select value={field.value} onValueChange={(v) => { const p = products.find((x) => x.name === v); field.onChange(v); if (p) form.setValue('product_code', p.code || ''); }}><FormControl><SelectTrigger><SelectValue placeholder="Select or type below" /></SelectTrigger></FormControl><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent></Select><FormControl className="mt-2"><Input {...field} placeholder="Product name" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="product_code" render={({ field }) => (<FormItem><FormLabel>Product Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="batch_number" render={({ field }) => (<FormItem><FormLabel>Batch Number *</FormLabel><Select value={field.value} onValueChange={(v) => { field.onChange(v); const b = batches.find((x) => x.batch_number === v); if (b) form.reset({ ...form.getValues(), ...mapBatchToForm(b) }); }}><FormControl><SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger></FormControl><SelectContent>{batches.map((b) => <SelectItem key={b.id} value={b.batch_number}>{b.batch_number}</SelectItem>)}</SelectContent></Select><FormControl className="mt-2"><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="mfg_date" render={({ field }) => (<FormItem><FormLabel>Manufacturing Date</FormLabel><FormControl><Input type="month" {...field} value={(field.value || '').slice(0, 7)} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="exp_date" render={({ field }) => (<FormItem><FormLabel>Expiry Date</FormLabel><FormControl><Input type="month" {...field} value={(field.value || '').slice(0, 7)} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="market_region" render={({ field }) => (<FormItem><FormLabel>Market / Region *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="customer_name" render={({ field }) => (<FormItem><FormLabel>Customer / Distributor</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
              </CardContent></Card>
            )}

            {step === 3 && (
              <Card><CardHeader><CardTitle>Step 3 — Reason & Risk</CardTitle></CardHeader><CardContent className="space-y-4">
                <FormField control={form.control} name="reason_for_recall" render={({ field }) => (<FormItem><FormLabel>Reason For Recall *</FormLabel><FormControl><Textarea rows={4} {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="recall_justification" render={({ field }) => (<FormItem><FormLabel>Recall Justification</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>)} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="impact_assessment" render={({ field }) => (<FormItem><FormLabel>Impact Assessment</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="risk_assessment" render={({ field }) => (<FormItem><FormLabel>Risk Assessment Summary</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>)} />
                </div>
              </CardContent></Card>
            )}

            {step === 4 && (
              <Card><CardHeader><CardTitle>Step 4 — Distribution & Recovery</CardTitle><CardDescription>{canDistribution ? 'Enter distribution and recovery quantities' : 'View only — contact warehouse for updates'}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3">
                <FormField control={form.control} name="stock_quantity" render={({ field }) => (<FormItem><FormLabel>Stock Quantity</FormLabel><FormControl><Input type="number" min={0} disabled={!canDistribution} {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="distributed_quantity" render={({ field }) => (<FormItem><FormLabel>Distributed Quantity *</FormLabel><FormControl><Input type="number" min={0} disabled={!canDistribution} {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="recovered_quantity" render={({ field }) => (<FormItem><FormLabel>Recovered Quantity</FormLabel><FormControl><Input type="number" min={0} disabled={!canDistribution} {...field} /></FormControl><FormMessage /></FormItem>)} />
                <div className="sm:col-span-3 rounded-lg border bg-green-50 p-3 text-sm"><strong>Recovery %:</strong> {recoveryPreview}% (auto-calculated)</div>
              </CardContent></Card>
            )}

            {step === 5 && (
              <Card><CardHeader><CardTitle>Step 5 — Regulatory & CAPA</CardTitle></CardHeader><CardContent className="space-y-4">
                <FormField control={form.control} name="regulatory_notification_required" render={({ field }) => (<FormItem className="flex items-center justify-between rounded-lg border p-3"><div><FormLabel>Regulatory Notification Required</FormLabel><FormDescription>Creates regulatory notification task when Yes</FormDescription></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canRegulatory} /></FormControl></FormItem>)} />
                {watchValues.regulatory_notification_required && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="regulatory_authority" render={({ field }) => (<FormItem><FormLabel>Regulatory Authority *</FormLabel><FormControl><Input {...field} disabled={!canRegulatory} placeholder="CDSCO / FDA / EMA" /></FormControl><FormMessage /></FormItem>)} />
                    <FormField control={form.control} name="notification_due_date" render={({ field }) => (<FormItem><FormLabel>Notification Due Date</FormLabel><FormControl><Input type="date" {...field} value={field.value || ''} disabled={!canRegulatory} /></FormControl><FormMessage /></FormItem>)} />
                  </div>
                )}
                <FormField control={form.control} name="capa_required" render={({ field }) => (<FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>CAPA Required</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>)} />
                {watchValues.capa_required && (
                  <FormField control={form.control} name="linked_capa_id" render={({ field }) => (<FormItem><FormLabel>Link CAPA</FormLabel><Select value={field.value || ''} onValueChange={(v) => { field.onChange(v); const c = capas.find((x) => x.id === v); form.setValue('linked_capa_number', c?.capa_number || ''); }}><FormControl><SelectTrigger><SelectValue placeholder="Select CAPA or create later" /></SelectTrigger></FormControl><SelectContent>{capas.map((c) => <SelectItem key={c.id} value={c.id}>{c.capa_number} — {c.title}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
                )}
              </CardContent></Card>
            )}

            {step === 6 && (
              <Card><CardHeader><CardTitle>Step 6 — Review & Submit</CardTitle></CardHeader><CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="assigned_owner_name" render={({ field }) => (<FormItem><FormLabel>Assigned Owner *</FormLabel><Select value={field.value} onValueChange={(v) => { field.onChange(v); const o = owners.find((x) => x.name === v); form.setValue('assigned_owner', o?.id || ''); }}><FormControl><SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger></FormControl><SelectContent>{owners.map((o) => <SelectItem key={o.id} value={o.name}>{o.name}{o.department ? ` (${o.department})` : ''}</SelectItem>)}</SelectContent></Select><FormControl className="mt-2"><Input {...field} /></FormControl><FormMessage /></FormItem>)} />
                  <FormField control={form.control} name="due_date" render={({ field }) => (<FormItem><FormLabel>Due Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>)} />
                </div>
                <FormField control={form.control} name="qa_remarks" render={({ field }) => (<FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={form.control} name="include_in_pqr_review" render={({ field }) => (<FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Include in PQR Recall Review</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>)} />
                <div className="rounded-lg border bg-slate-50 p-4 text-sm space-y-1">
                  <p><strong>Product:</strong> {watchValues.product_name} / {watchValues.batch_number}</p>
                  <p><strong>Classification:</strong> {watchValues.recall_classification} · <strong>Type:</strong> {watchValues.recall_type}</p>
                  <p><strong>Recovery:</strong> {recoveryPreview}% · <strong>Due:</strong> {watchValues.due_date}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleAttachmentPlaceholder()}><Paperclip className="mr-1 h-4 w-4" />Attachment Upload (placeholder)</Button>
              </CardContent></Card>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => router.push('/qms/recall')} disabled={busy}>Cancel</Button>
                {step > 1 && <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy}><ArrowLeft className="mr-1 h-4 w-4" />Back</Button>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => void handleSaveDraft()} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}Save Draft</Button>
                {step < RECALL_WIZARD_STEPS.length ? (
                  <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleNext()} disabled={busy}>Next<ArrowRight className="ml-1 h-4 w-4" /></Button>
                ) : (
                  <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleInitiate()} disabled={busy}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}Initiate Recall</Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </div>
    </RecallCreateAccessGuard>
  );
}
