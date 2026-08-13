'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowLeft, ArrowRight, ImageIcon, Loader2, Paperclip, Save, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  COMPLAINT_WIZARD_STEPS,
  computeComplaintAutoRules,
  mapBatchToForm,
  mapCustomerToForm,
} from '@/lib/complaint-create-records';
import {
  complaintCreateSchema,
  complaintStep1Schema,
  complaintStep2Schema,
  complaintStep3Schema,
  complaintStep4Schema,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CRITICALITIES,
  COMPLAINT_CUSTOMER_TYPES,
  COMPLAINT_SOURCES,
  COMPLAINT_SUBCATEGORIES,
  type ComplaintCreateInput,
} from '@/lib/complaint-schemas';
import {
  fetchComplaintBatchOptions,
  fetchComplaintCustomerOptions,
  fetchComplaintInvestigatorOptions,
  fetchComplaintProductOptions,
  generateComplaintNumberPreview,
  saveComplaintDraft,
  submitComplaintCreate,
  uploadComplaintCreateAttachment,
} from '@/lib/complaint-create-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ComplaintCreateAccessGuard } from './complaint-create-access-guard';
import { ComplaintCreateWizard } from './complaint-create-wizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STEP_SCHEMAS = [complaintStep1Schema, complaintStep2Schema, complaintStep3Schema, complaintStep4Schema, complaintCreateSchema];

export function CreateComplaintPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <CreateComplaintInner />
    </Suspense>
  );
}

function CreateComplaintInner() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previewNumber, setPreviewNumber] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Awaited<ReturnType<typeof fetchComplaintCustomerOptions>>>([]);
  const [products, setProducts] = useState<Awaited<ReturnType<typeof fetchComplaintProductOptions>>>([]);
  const [batches, setBatches] = useState<Awaited<ReturnType<typeof fetchComplaintBatchOptions>>>([]);
  const [investigators, setInvestigators] = useState<Awaited<ReturnType<typeof fetchComplaintInvestigatorOptions>>>([]);
  const [attachments, setAttachments] = useState<{ id: string; file_name: string }[]>([]);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: profile?.role || '',
    department: profile?.department || '',
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role, profile?.department]);

  const form = useForm<ComplaintCreateInput>({
    resolver: zodResolver(complaintCreateSchema),
    defaultValues: {
      complaint_date: new Date().toISOString().split('T')[0],
      received_from: 'Customer',
      customer_name: '',
      customer_type: 'Retail',
      country: '',
      contact_person: '',
      customer_contact: '',
      market_region: '',
      product_name: '',
      product_code: '',
      batch_number: '',
      mfg_date: '',
      exp_date: '',
      complaint_category: 'Quality Defect',
      complaint_subcategory: 'Other',
      complaint_description: '',
      issue_reported: '',
      quantity_involved: '',
      sample_received: false,
      photographs_available: false,
      retain_sample_required: false,
      product_quality_impact: false,
      product_safety_impact: false,
      regulatory_impact: false,
      market_impact: false,
      recall_evaluation_required: false,
      complaint_criticality: 'Minor',
      assigned_to: '',
      assigned_to_name: '',
      due_date: '',
      investigation_required: true,
      initial_assessment: '',
      qa_remarks: '',
      risk_level: 'Low',
    },
  });

  const watchCriticality = form.watch('complaint_criticality');
  const watchPatientSafety = form.watch('product_safety_impact');
  const watchRegulatory = form.watch('regulatory_impact');
  const watchMarketImpact = form.watch('market_impact');
  const watchProductQuality = form.watch('product_quality_impact');
  const watchProductName = form.watch('product_name');

  const autoRules = useMemo(() => computeComplaintAutoRules({
    product_safety_impact: watchPatientSafety,
    regulatory_impact: watchRegulatory,
    market_impact: watchMarketImpact,
    product_quality_impact: watchProductQuality,
    complaint_criticality: watchCriticality,
  }), [watchCriticality, watchPatientSafety, watchRegulatory, watchMarketImpact, watchProductQuality]);

  useEffect(() => {
    if (autoRules.recall_evaluation_enabled) {
      form.setValue('recall_evaluation_required', true);
    }
  }, [autoRules.recall_evaluation_enabled, form]);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const [num, cust, prods, inv] = await Promise.all([
        generateComplaintNumberPreview(),
        fetchComplaintCustomerOptions(),
        fetchComplaintProductOptions(),
        fetchComplaintInvestigatorOptions(),
      ]);
      setPreviewNumber(num);
      setCustomers(cust);
      setProducts(prods);
      setInvestigators(inv);
      if (!num) {
        toast.error('Complaint numbering backend configuration is not available.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  useEffect(() => {
    void fetchComplaintBatchOptions(watchProductName).then(setBatches);
  }, [watchProductName]);

  const validateStep = async (s: number) => {
    const schema = STEP_SCHEMAS[s - 1];
    const parsed = schema.safeParse(form.getValues());
    if (!parsed.success) {
      parsed.error.errors.forEach((issue) => {
        const path = issue.path[0];
        if (typeof path === 'string') {
          form.setError(path as keyof ComplaintCreateInput, { message: issue.message });
        }
      });
      toast.error(parsed.error.errors[0]?.message || 'Please complete required fields');
      return false;
    }
    return true;
  };

  const handleNext = async () => {
    if (await validateStep(step)) setStep((s) => Math.min(s + 1, COMPLAINT_WIZARD_STEPS.length));
  };

  const handleSaveDraft = async () => {
    setBusy(true);
    const { record, error } = await saveComplaintDraft(form.getValues(), actor, draftId);
    setBusy(false);
    if (error || !record) toast.error(error || 'Failed to save draft');
    else {
      setDraftId(record.id);
      toast.success(`Draft saved — ${record.complaint_number}`);
    }
  };

  const handleSubmit = async () => {
    const parsed = complaintCreateSchema.safeParse(form.getValues());
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Validation failed');
      return;
    }
    setBusy(true);
    const { record, error } = await submitComplaintCreate(parsed.data, actor, draftId);
    setBusy(false);
    if (error || !record) toast.error(error || 'Submit failed');
    else {
      toast.success(`Complaint ${record.complaint_number} submitted`);
      router.push(`/qms/complaints/${record.id}`);
    }
  };

  const handleCustomerPick = (customerId: string) => {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    const mapped = mapCustomerToForm(customer);
    Object.entries(mapped).forEach(([key, value]) => {
      form.setValue(key as keyof ComplaintCreateInput, value as never);
    });
    toast.success('Customer details loaded');
  };

  const handleBatchPick = (batchNumber: string) => {
    const batch = batches.find((b) => b.batch_number === batchNumber);
    if (!batch) return;
    const mapped = mapBatchToForm(batch);
    Object.entries(mapped).forEach(([key, value]) => {
      if (key !== 'batch_id') form.setValue(key as keyof ComplaintCreateInput, value as never);
    });
    const product = products.find((p) => p.name === batch.product_name);
    if (product?.code) form.setValue('product_code', product.code);
    toast.success('Batch details linked');
  };

  const handleProductPick = (productName: string) => {
    form.setValue('product_name', productName);
    const product = products.find((p) => p.name === productName);
    if (product?.code) form.setValue('product_code', product.code);
  };

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!draftId) {
      toast.error('Save draft first to upload attachments');
      e.target.value = '';
      return;
    }
    setBusy(true);
    const result = await uploadComplaintCreateAttachment(draftId, file, actor);
    setBusy(false);
    if (result.error) toast.error(result.error);
    else {
      setAttachments((prev) => [...prev, { id: result.id, file_name: result.file_name }]);
      toast.success('Attachment uploaded');
    }
    e.target.value = '';
  };

  if (loading) return <LoadingSkeleton rows={4} />;

  return (
    <ComplaintCreateAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Create Complaint"
          description="Record customer and market complaints for investigation and resolution"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/complaints' },
            { label: 'Complaint Management', href: '/qms/complaints' },
            { label: 'Create Complaint' },
          ]}
        />

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/qms/complaints" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>
          <span className="ml-auto font-mono text-blue-700">{previewNumber || 'Number not available from backend'}</span>
        </div>

        {(autoRules.head_qa_approval_required || autoRules.notify_head_qa) && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Critical / Patient Safety Alert</AlertTitle>
            <AlertDescription>
              Head QA review is mandatory for this complaint.
              {autoRules.capa_recommendation_required && ' CAPA recommendation will be flagged.'}
            </AlertDescription>
          </Alert>
        )}

        {autoRules.recall_evaluation_enabled && (
          <Alert>
            <AlertTitle>Recall Evaluation</AlertTitle>
            <AlertDescription>Market impact detected — recall evaluation will be enabled on submission.</AlertDescription>
          </Alert>
        )}

        <ComplaintCreateWizard step={step} />

        <Form {...form}>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
            {step === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Source & Customer</CardTitle>
                  <CardDescription>Complaint source, customer details and market information</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="complaint_date" render={({ field }) => (
                    <FormItem><FormLabel>Complaint Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="received_from" render={({ field }) => (
                    <FormItem><FormLabel>Complaint Source *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>{COMPLAINT_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="customer_name" render={({ field }) => (
                    <FormItem><FormLabel>Customer Name *</FormLabel>
                      <div className="space-y-2">
                        {customers.length > 0 && (
                          <Select onValueChange={handleCustomerPick}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Lookup customer" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {customers.slice(0, 50).map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}{c.country ? ` — ${c.country}` : ''}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <FormControl><Input {...field} placeholder="Customer name" /></FormControl>
                      </div>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="customer_type" render={({ field }) => (
                    <FormItem><FormLabel>Customer Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>{COMPLAINT_CUSTOMER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="country" render={({ field }) => (
                    <FormItem><FormLabel>Country</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="market_region" render={({ field }) => (
                    <FormItem><FormLabel>Market *</FormLabel><FormControl><Input {...field} placeholder="Domestic / Export / Region" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="contact_person" render={({ field }) => (
                    <FormItem><FormLabel>Contact Person</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="customer_contact" render={({ field }) => (
                    <FormItem><FormLabel>Contact Details</FormLabel><FormControl><Input {...field} placeholder="Phone / email" /></FormControl><FormMessage /></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card>
                <CardHeader><CardTitle>Product & Batch</CardTitle><CardDescription>Link product and batch for PQR / CPV traceability</CardDescription></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="product_name" render={({ field }) => (
                    <FormItem><FormLabel>Product Name *</FormLabel>
                      <Select onValueChange={(v) => handleProductPick(v)} value={field.value || undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger></FormControl>
                        <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}{p.code ? ` (${p.code})` : ''}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormControl><Input className="mt-2" {...field} placeholder="Or enter product name" /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="product_code" render={({ field }) => (
                    <FormItem><FormLabel>Product Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="batch_number" render={({ field }) => (
                    <FormItem><FormLabel>Batch Number</FormLabel>
                      <Select onValueChange={(v) => { field.onChange(v); handleBatchPick(v); }} value={field.value || undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger></FormControl>
                        <SelectContent>{batches.map((b) => <SelectItem key={b.id} value={b.batch_number}>{b.batch_number}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormControl><Input className="mt-2" {...field} placeholder="Or enter batch number" /></FormControl>
                      <FormDescription>Batch links complaint to PQR and CPV records when available.</FormDescription>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="mfg_date" render={({ field }) => (
                    <FormItem><FormLabel>Manufacturing Date</FormLabel><FormControl><Input type="month" {...field} value={(field.value || '').slice(0, 7)} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="exp_date" render={({ field }) => (
                    <FormItem><FormLabel>Expiry Date</FormLabel><FormControl><Input type="month" {...field} value={(field.value || '').slice(0, 7)} /></FormControl><FormMessage /></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card>
                <CardHeader><CardTitle>Complaint & Impact Assessment</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField control={form.control} name="complaint_category" render={({ field }) => (
                      <FormItem><FormLabel>Complaint Category *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{COMPLAINT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="complaint_subcategory" render={({ field }) => (
                      <FormItem><FormLabel>Subcategory</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{COMPLAINT_SUBCATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="complaint_criticality" render={({ field }) => (
                      <FormItem><FormLabel>Criticality *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{COMPLAINT_CRITICALITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="quantity_involved" render={({ field }) => (
                      <FormItem><FormLabel>Quantity Involved</FormLabel><FormControl><Input {...field} placeholder="Units / packs" /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="complaint_description" render={({ field }) => (
                    <FormItem><FormLabel>Complaint Description *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="issue_reported" render={({ field }) => (
                    <FormItem><FormLabel>Issue Reported</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="initial_assessment" render={({ field }) => (
                    <FormItem><FormLabel>Initial Assessment</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {([
                      ['sample_received', 'Sample Available'],
                      ['photographs_available', 'Photographs Available'],
                      ['retain_sample_required', 'Retain Sample Required'],
                      ['product_quality_impact', 'Product Quality Impact'],
                      ['product_safety_impact', 'Patient Safety Impact'],
                      ['regulatory_impact', 'Regulatory Impact'],
                      ['market_impact', 'Market Impact'],
                      ['recall_evaluation_required', 'Recall Evaluation Required'],
                    ] as const).map(([name, label]) => (
                      <FormField key={name} control={form.control} name={name} render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-3">
                          <FormLabel className="text-sm">{label}</FormLabel>
                          <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={name === 'recall_evaluation_required' && autoRules.recall_evaluation_enabled} /></FormControl>
                        </FormItem>
                      )} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 4 && (
              <Card>
                <CardHeader><CardTitle>Investigation Assignment</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="assigned_to_name" render={({ field }) => (
                    <FormItem><FormLabel>Assigned Investigator *</FormLabel>
                      <Select onValueChange={(v) => {
                        const inv = investigators.find((x) => x.name === v);
                        field.onChange(v);
                        if (inv) form.setValue('assigned_to', inv.id);
                      }} value={field.value || undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select investigator" /></SelectTrigger></FormControl>
                        <SelectContent>{investigators.map((i) => <SelectItem key={i.id} value={i.name}>{i.name}{i.department ? ` (${i.department})` : ''}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormControl><Input className="mt-2" {...field} placeholder="Investigator name" onChange={(e) => { field.onChange(e); form.setValue('assigned_to', e.target.value); }} /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="due_date" render={({ field }) => (
                    <FormItem><FormLabel>Target Closure Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="investigation_required" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
                      <FormLabel>Investigation Required</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="qa_remarks" render={({ field }) => (
                    <FormItem className="sm:col-span-2"><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 5 && (
              <Card>
                <CardHeader><CardTitle>Attachments & Submit</CardTitle><CardDescription>Upload evidence — photos, PDF, Word, Excel, email or customer letters</CardDescription></CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-dashed p-4">
                    <FormLabel className="mb-2 flex items-center gap-2"><Paperclip className="h-4 w-4" /> Attachments</FormLabel>
                    <Input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.eml,.msg" onChange={(e) => void handleAttachment(e)} disabled={busy} />
                    <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Storage: /complaints/&#123;complaintId&#125;/&#123;fileName&#125;</p>
                    {attachments.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {attachments.map((a) => <li key={a.id}>{a.file_name}</li>)}
                      </ul>
                    )}
                  </div>
                  <div className="rounded-lg bg-muted/50 p-4 text-sm">
                    <p className="font-medium">Submission summary</p>
                    <ul className="mt-2 list-disc pl-5 text-muted-foreground space-y-1">
                      <li>Customer: {form.watch('customer_name') || '—'}</li>
                      <li>Product: {form.watch('product_name') || '—'} {form.watch('batch_number') ? `(Batch ${form.watch('batch_number')})` : ''}</li>
                      <li>Category: {form.watch('complaint_category')} · Criticality: {form.watch('complaint_criticality')}</li>
                      <li>Investigator: {form.watch('assigned_to_name') || '—'} · Due: {form.watch('due_date') || '—'}</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                {step > 1 && (
                  <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                    <ArrowLeft className="mr-1 h-4 w-4" /> Back
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => void handleSaveDraft()} disabled={busy}>
                  <Save className="mr-1 h-4 w-4" /> Save Draft
                </Button>
              </div>
              <div className="flex gap-2">
                {step < COMPLAINT_WIZARD_STEPS.length ? (
                  <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleNext()} disabled={busy}>
                    Next <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleSubmit()} disabled={busy}>
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                    Submit Complaint
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </div>
    </ComplaintCreateAccessGuard>
  );
}
