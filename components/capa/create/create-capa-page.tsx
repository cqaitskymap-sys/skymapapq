'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Paperclip, Save, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  CAPA_WIZARD_STEPS,
  computeCapaAutoRules,
  sourceNeedsReference,
} from '@/lib/capa-create-records';
import {
  capaCreateSchema,
  capaStep1Schema,
  capaStep2Schema,
  capaStep3Schema,
  capaStep4Schema,
  capaStep5Schema,
  CAPA_SOURCES,
  CAPA_DEPARTMENTS,
  CAPA_PRIORITIES,
  type CapaCreateInput,
} from '@/lib/capa-schemas';
import {
  fetchCapaBatchOptions,
  fetchCapaOwnerOptions,
  fetchCapaProductOptions,
  generateCapaNumberPreview,
  lookupCapaSourceReference,
  saveCapaDraft,
  submitCapaCreate,
  uploadCapaAttachmentPlaceholder,
} from '@/lib/capa-create-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { CapaCreateAccessGuard } from './capa-create-access-guard';
import { CapaCreateWizard } from './capa-create-wizard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STEP_SCHEMAS = [capaStep1Schema, capaStep2Schema, capaStep3Schema, capaStep4Schema, capaStep5Schema, capaCreateSchema];

export function CreateCapaPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <CreateCapaInner />
    </Suspense>
  );
}

function CreateCapaInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [previewNumber, setPreviewNumber] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; batch_number: string }[]>([]);
  const [owners, setOwners] = useState<{ id: string; name: string }[]>([]);
  const [attachments, setAttachments] = useState<{ id: string; file_name: string }[]>([]);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: profile?.role || '',
    department: profile?.department || '',
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role, profile?.department]);

  const form = useForm<CapaCreateInput>({
    resolver: zodResolver(capaCreateSchema),
    defaultValues: {
      capa_date: new Date().toISOString().split('T')[0],
      capa_source: 'Deviation',
      source_reference_number: searchParams.get('ref') || '',
      department: 'QA',
      product_name: '',
      batch_number: '',
      capa_title: '',
      problem_description: '',
      root_cause: '',
      corrective_action: '',
      preventive_action: '',
      action_owner: user?.uid || '',
      action_owner_name: profile?.full_name || '',
      target_completion_date: '',
      effectiveness_check_required: true,
      effectiveness_check_date: '',
      effectiveness_criteria: '',
      priority: 'medium',
      criticality: 'Medium',
      qa_reviewer: '',
      qa_reviewer_name: '',
      qa_remarks: '',
    },
  });

  const watchSource = form.watch('capa_source');
  const watchPriority = form.watch('priority');
  const watchEffectiveness = form.watch('effectiveness_check_required');
  const autoRules = useMemo(() => computeCapaAutoRules(watchPriority), [watchPriority]);

  useEffect(() => {
    form.setValue('criticality', autoRules.criticality);
  }, [autoRules.criticality, form]);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const [num, prods, own] = await Promise.all([
        generateCapaNumberPreview(),
        fetchCapaProductOptions(),
        fetchCapaOwnerOptions(),
      ]);
      setPreviewNumber(num);
      setProducts(prods);
      setOwners(own);
      if (!num) {
        toast.error('CAPA numbering backend configuration is not available.');
      }
      const source = searchParams.get('source');
      if (source && CAPA_SOURCES.includes(source as typeof CAPA_SOURCES[number])) {
        form.setValue('capa_source', source as CapaCreateInput['capa_source']);
      }
      if (searchParams.get('ref')) {
        void handleSourceLookup(searchParams.get('ref') || '');
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  const watchProductName = form.watch('product_name');

  useEffect(() => {
    void fetchCapaBatchOptions(watchProductName).then(setBatches);
  }, [watchProductName]);

  const handleSourceLookup = async (ref?: string) => {
    const reference = ref || form.getValues('source_reference_number');
    if (!reference.trim()) return toast.message('Enter a source reference number');
    setLookupBusy(true);
    try {
      const result = await lookupCapaSourceReference(form.getValues('capa_source'), reference);
      if (!result.found) {
        toast.message(result.message || 'No matching source record');
        return;
      }
      if (result.product_name) form.setValue('product_name', result.product_name);
      if (result.batch_number) form.setValue('batch_number', result.batch_number);
      if (result.department) form.setValue('department', result.department as CapaCreateInput['department']);
      if (result.problem_description) form.setValue('problem_description', result.problem_description);
      if (result.root_cause) form.setValue('root_cause', result.root_cause);
      if (result.capa_title) form.setValue('capa_title', result.capa_title);
      if (result.priority) form.setValue('priority', result.priority as CapaCreateInput['priority']);
      toast.success('Source details loaded');
    } finally {
      setLookupBusy(false);
    }
  };

  const validateStep = async (s: number) => {
    const schema = STEP_SCHEMAS[s - 1];
    const values = form.getValues();
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      parsed.error.errors.forEach((issue) => {
        const path = issue.path[0];
        if (typeof path === 'string') {
          form.setError(path as keyof CapaCreateInput & string, { message: issue.message });
        }
      });
      toast.error(parsed.error.errors[0]?.message || 'Please complete required fields');
      return false;
    }
    return true;
  };

  const handleNext = async () => {
    if (await validateStep(step)) setStep((s) => Math.min(s + 1, CAPA_WIZARD_STEPS.length));
  };

  const handleSaveDraft = async () => {
    setBusy(true);
    const { record, error } = await saveCapaDraft(form.getValues(), actor);
    setBusy(false);
    if (error || !record) toast.error(error || 'Failed to save draft');
    else {
      setDraftId(record.id);
      toast.success(`Draft saved — ${record.capa_number}`);
    }
  };

  const handleSubmit = async () => {
    const parsed = capaCreateSchema.safeParse(form.getValues());
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Validation failed');
      return;
    }
    setBusy(true);
    const { record, error } = await submitCapaCreate(parsed.data, actor, draftId);
    setBusy(false);
    if (error || !record) toast.error(error || 'Submit failed');
    else {
      toast.success(`CAPA ${record.capa_number} submitted`);
      router.push(`/qms/capa/${record.id}`);
    }
  };

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const att = await uploadCapaAttachmentPlaceholder(draftId || 'draft', file.name, actor);
      setAttachments((prev) => [...prev, att]);
      toast.success('Attachment uploaded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Attachment upload failed');
    }
    e.target.value = '';
  };

  if (loading) return <LoadingSkeleton rows={4} />;

  return (
    <CapaCreateAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Create CAPA"
          description="Create corrective and preventive action with ownership and effectiveness tracking"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/capa' },
            { label: 'CAPA Management', href: '/qms/capa' },
            { label: 'Create CAPA' },
          ]}
        />

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/qms/capa" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>
          <span className="ml-auto font-mono text-blue-700">{previewNumber || 'Number not available from backend'}</span>
        </div>

        {autoRules.head_qa_approval_required && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Critical CAPA</AlertTitle>
            <AlertDescription>Head QA approval will be required after submission.</AlertDescription>
          </Alert>
        )}

        <CapaCreateWizard step={step} />

        <Form {...form}>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
            {step === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Source & Basic Information</CardTitle>
                  <CardDescription>Select CAPA source and enter basic identification details</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="capa_date" render={({ field }) => (
                    <FormItem><FormLabel>CAPA Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="capa_source" render={({ field }) => (
                    <FormItem><FormLabel>CAPA Source *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>{CAPA_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                  {sourceNeedsReference(watchSource) && (
                    <FormField control={form.control} name="source_reference_number" render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Source Reference Number *</FormLabel>
                        <div className="flex gap-2">
                          <FormControl><Input {...field} placeholder="DEV-..., OOS-..., AUD-..." /></FormControl>
                          <Button type="button" variant="outline" onClick={() => void handleSourceLookup()} disabled={lookupBusy}>
                            {lookupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )} />
                  )}
                  <FormField control={form.control} name="department" render={({ field }) => (
                    <FormItem><FormLabel>Department *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>{CAPA_DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="capa_title" render={({ field }) => (
                    <FormItem className="sm:col-span-2"><FormLabel>CAPA Title *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card>
                <CardHeader><CardTitle>Product & Batch</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="product_name" render={({ field }) => (
                    <FormItem><FormLabel>Product Name</FormLabel>
                      <Select
                        onValueChange={(v) => {
                          const product = products.find((p) => p.id === v);
                          field.onChange(product?.name || v);
                        }}
                        value={products.find((p) => p.name === field.value)?.id || undefined}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="Select or type below" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormControl><Input className="mt-2" {...field} placeholder="Or enter product name" /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="batch_number" render={({ field }) => (
                    <FormItem><FormLabel>Batch Number</FormLabel>
                      <Select
                        onValueChange={(v) => {
                          const batch = batches.find((b) => b.id === v);
                          field.onChange(batch?.batch_number || v);
                        }}
                        value={batches.find((b) => b.batch_number === field.value)?.id || undefined}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {batches.map((b) => <SelectItem key={b.id} value={b.id}>{b.batch_number}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormControl><Input className="mt-2" {...field} placeholder="Or enter batch" /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card>
                <CardHeader><CardTitle>Problem & Root Cause</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="problem_description" render={({ field }) => (
                    <FormItem><FormLabel>Problem Description *</FormLabel><FormControl><Textarea rows={4} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="root_cause" render={({ field }) => (
                    <FormItem><FormLabel>Root Cause *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 4 && (
              <Card>
                <CardHeader><CardTitle>Corrective & Preventive Actions</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="corrective_action" render={({ field }) => (
                    <FormItem><FormLabel>Corrective Action *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="preventive_action" render={({ field }) => (
                    <FormItem><FormLabel>Preventive Action *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="action_owner_name" render={({ field }) => (
                    <FormItem><FormLabel>Action Owner *</FormLabel>
                      <Select onValueChange={(v) => {
                        const o = owners.find((x) => x.name === v);
                        field.onChange(v);
                        if (o) form.setValue('action_owner', o.id);
                      }} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger></FormControl>
                        <SelectContent>{owners.map((o) => <SelectItem key={o.id} value={o.name}>{o.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormControl><Input className="mt-2" {...field} placeholder="Owner name" onChange={(e) => { field.onChange(e); form.setValue('action_owner', e.target.value); }} /></FormControl>
                      <FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="target_completion_date" render={({ field }) => (
                    <FormItem><FormLabel>Target Completion Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="priority" render={({ field }) => (
                    <FormItem><FormLabel>Priority *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>{CAPA_PRIORITIES.map((p) => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}</SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="criticality" render={({ field }) => (
                    <FormItem><FormLabel>Criticality</FormLabel><FormControl><Input {...field} readOnly className="bg-muted" /></FormControl></FormItem>
                  )} />
                </CardContent>
              </Card>
            )}

            {step === 5 && (
              <Card>
                <CardHeader><CardTitle>Effectiveness & Submit</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <FormField control={form.control} name="effectiveness_check_required" render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <FormLabel>Effectiveness Check Required</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )} />
                  {watchEffectiveness && (
                    <>
                      <FormField control={form.control} name="effectiveness_check_date" render={({ field }) => (
                        <FormItem><FormLabel>Effectiveness Check Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="effectiveness_criteria" render={({ field }) => (
                        <FormItem><FormLabel>Effectiveness Criteria *</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </>
                  )}
                  <FormField control={form.control} name="qa_reviewer_name" render={({ field }) => (
                    <FormItem><FormLabel>QA Reviewer</FormLabel><FormControl><Input {...field} placeholder="QA reviewer name" onChange={(e) => { field.onChange(e); form.setValue('qa_reviewer', e.target.value); }} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="qa_remarks" render={({ field }) => (
                    <FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                  )} />
                  <div className="rounded-lg border border-dashed p-4">
                    <FormLabel className="flex items-center gap-2 mb-2"><Paperclip className="h-4 w-4" /> Attachments (placeholder)</FormLabel>
                    <Input type="file" onChange={(e) => void handleAttachment(e)} />
                    {attachments.length > 0 && (
                      <ul className="mt-2 text-xs text-muted-foreground">{attachments.map((a) => <li key={a.id}>{a.file_name}</li>)}</ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex flex-wrap gap-2 justify-between">
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
                {step < CAPA_WIZARD_STEPS.length ? (
                  <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleNext()} disabled={busy}>
                    Next <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleSubmit()} disabled={busy}>
                    {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                    Submit CAPA
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </div>
    </CapaCreateAccessGuard>
  );
}
