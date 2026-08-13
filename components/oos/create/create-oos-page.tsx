'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  computeOosAutoRules,
  computeOosCreateResultStatus,
  OOS_SAMPLE_TYPES,
  requiresBatchNumber,
  type OosBatchOption,
  type OosInvestigatorOption,
  type OosProductOption,
} from '@/lib/oos-create-records';
import {
  oosCreateSchema,
  oosStep1Schema,
  oosStep2Schema,
  oosStep3Schema,
  oosStep4Schema,
  oosStep5Schema,
  type OosCreateInput,
} from '@/lib/oos-schemas';
import { DEPARTMENTS } from '@/lib/oos-types';
import {
  fetchCqaPrefill,
  fetchOosBatches,
  fetchOosInvestigators,
  fetchOosProducts,
  fetchStabilityPrefill,
  generateOosNumberForDepartment,
  logOosCreateAudit,
  saveOosDraft,
  submitOosFromCreate,
  uploadOosCreateAttachmentPlaceholder,
} from '@/lib/oos-create-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { OosCreateAccessGuard } from './oos-create-access-guard';
import { OosStepWizard } from './oos-step-wizard';
import { OosSpecComparisonCard } from './oos-spec-comparison-card';
import { OosAttachmentPlaceholder } from './oos-attachment-placeholder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STEP_SCHEMAS = [oosStep1Schema, oosStep2Schema, oosStep3Schema, oosStep4Schema, oosStep5Schema, oosCreateSchema];

export function CreateOosPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={4} />}>
      <CreateOosInner />
    </Suspense>
  );
}

function CreateOosInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<OosProductOption[]>([]);
  const [batches, setBatches] = useState<OosBatchOption[]>([]);
  const [investigators, setInvestigators] = useState<OosInvestigatorOption[]>([]);
  const [previewNumber, setPreviewNumber] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ id: string; file_name: string }[]>([]);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: profile?.role,
    email: profile?.email,
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role]);

  const form = useForm<OosCreateInput>({
    resolver: zodResolver(oosCreateSchema),
    defaultValues: {
      oos_date: new Date().toISOString().split('T')[0],
      department: 'QC',
      sample_type: 'Finished Product',
      product_name: '',
      product_id: null,
      batch_number: '',
      test_name: '',
      test_method: '',
      stp_number: '',
      specification_number: '',
      parameter_name: '',
      spec_lower_limit: 0,
      spec_upper_limit: 100,
      observed_result: 0,
      unit: '%',
      analyst_name: profile?.full_name || '',
      instrument_used: '',
      initial_observation: '',
      immediate_action: '',
      is_critical_test: false,
      batch_release_blocked: false,
      capa_required: false,
      assigned_investigator_name: '',
      assigned_to: null,
      target_closure_date: '',
      remarks: '',
      source: 'manual',
      source_reference: null,
      cpv_record_id: null,
      stability_record_id: null,
      cqa_result_id: null,
    },
  });

  const watched = form.watch();
  const autoRules = useMemo(() => computeOosAutoRules(watched), [watched]);
  const resultStatus = computeOosCreateResultStatus(
    Number(watched.observed_result) || 0,
    Number(watched.spec_lower_limit) || 0,
    Number(watched.spec_upper_limit) || 0,
  );

  const loadMeta = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prods, invs] = await Promise.all([fetchOosProducts(), fetchOosInvestigators()]);
      setProducts(prods);
      setInvestigators(invs);

      const source = searchParams.get('source');
      const sourceId = searchParams.get('sourceId') || searchParams.get('id');
      if (source === 'cqa' && sourceId) {
        const pre = await fetchCqaPrefill(sourceId);
        if (pre) {
          form.reset({
            ...form.getValues(),
            ...mapPrefill(pre),
            source: 'cpv_cqa',
            source_reference: sourceId,
            cpv_record_id: sourceId,
            cqa_result_id: sourceId,
          });
        }
      } else if (source === 'stability' && sourceId) {
        const pre = await fetchStabilityPrefill(sourceId);
        if (pre) {
          form.reset({
            ...form.getValues(),
            ...mapPrefill(pre),
            source: 'cpv_cpp',
            source_reference: sourceId,
            stability_record_id: sourceId,
            cpv_record_id: sourceId,
          });
        }
      }

      const dept = form.getValues('department') || 'QC';
      const preview = await generateOosNumberForDepartment(dept);
      setPreviewNumber(preview);
      if (!preview) {
        setError('OOS numbering is not available from backend configuration.');
      }
      const productName = form.getValues('product_name');
      if (productName) setBatches(await fetchOosBatches(productName));
    } catch {
      setError('Failed to load reference data.');
    } finally {
      setLoading(false);
    }
  }, [searchParams, form]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);

  useEffect(() => {
    void logOosCreateAudit('create form opened', actor, 'new', 'Create OOS page viewed');
  }, [actor]);

  useEffect(() => {
    const dept = watched.department;
    if (!dept) return;
    void generateOosNumberForDepartment(dept).then((preview) => {
      setPreviewNumber(preview);
      if (!preview) setError('OOS numbering is not available from backend configuration.');
    });
  }, [watched.department]);

  useEffect(() => {
    const pn = watched.product_name;
    if (!pn) { setBatches([]); return; }
    void fetchOosBatches(pn).then(setBatches);
  }, [watched.product_name]);

  useEffect(() => {
    if (autoRules.batchBlocked && !form.getValues('batch_release_blocked')) {
      form.setValue('batch_release_blocked', true);
    }
  }, [autoRules.batchBlocked, form]);

  const validateStep = async () => {
    const schema = STEP_SCHEMAS[step - 1];
    const values = form.getValues();
    const result = schema.safeParse(values);
    if (!result.success) {
      result.error.issues.forEach((issue: { path: (string | number)[]; message: string }) => {
        const path = issue.path[0];
        if (typeof path === 'string') {
          form.setError(path as keyof OosCreateInput, { message: issue.message });
        }
      });
      toast.error('Please complete required fields before continuing.');
      return false;
    }
    return true;
  };

  const handleNext = async () => {
    if (!(await validateStep())) return;
    setStep((s) => Math.min(s + 1, STEP_SCHEMAS.length));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  const handleSaveDraft = async () => {
    setBusy(true);
    try {
      const record = await saveOosDraft(form.getValues(), actor, draftId);
      setDraftId(record.id);
      await logOosCreateAudit('create form draft saved', actor, record.id, record.oos_number);
      toast.success(`Draft saved — ${record.oos_number}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save draft');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    const valid = await form.trigger();
    if (!valid) {
      toast.error('Please fix validation errors before submitting.');
      return;
    }
    setBusy(true);
    try {
      const record = await submitOosFromCreate(form.getValues(), actor, draftId);
      toast.success(`OOS ${record.oos_number} submitted — ${autoRules.resultStatus}`);
      router.push(`/qms/oos/${record.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit OOS');
    } finally {
      setBusy(false);
    }
  };

  const handleAttachment = async (fileName: string) => {
    try {
      if (!draftId) {
        const record = await saveOosDraft(form.getValues(), actor);
        setDraftId(record.id);
        const att = await uploadOosCreateAttachmentPlaceholder(record.id, fileName, actor);
        setAttachments((prev) => [...prev, att]);
        return;
      }
      const att = await uploadOosCreateAttachmentPlaceholder(draftId, fileName, actor);
      setAttachments((prev) => [...prev, att]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Attachment upload failed');
    }
  };

  return (
    <OosCreateAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Create OOS"
          description="Record Out of Specification result and initiate investigation"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/oos' },
            { label: 'OOS Management', href: '/qms/oos' },
            { label: 'Create OOS' },
          ]}
          actions={(
            <Link href="/qms/oos">
              <Button variant="outline" size="sm"><ArrowLeft className="mr-1 h-4 w-4" /> Back to Dashboard</Button>
            </Link>
          )}
        />

        {loading ? <LoadingSkeleton rows={4} /> : error ? (
          <ErrorCard title="Load error" message={error} onRetry={() => void loadMeta()} />
        ) : (
          <>
            <OosStepWizard step={step} />

            {autoRules.warnings.length > 0 && step >= 4 && (
              <Alert variant={autoRules.isOos ? 'destructive' : 'default'}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Auto Rules</AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 list-disc pl-4 text-sm">
                    {autoRules.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <Form {...form}>
              <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                {step === 1 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Basic Information</CardTitle>
                      <CardDescription>OOS header and sample classification</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      <div className="md:col-span-2 lg:col-span-3 rounded-md border bg-blue-50/50 px-4 py-3 text-sm">
                        <span className="text-muted-foreground">OOS Number (auto): </span>
                        <span className="font-mono font-semibold text-blue-700">{previewNumber || 'Not available from backend'}</span>
                      </div>
                      <FormField control={form.control} name="oos_date" render={({ field }) => (
                        <FormItem><FormLabel>OOS Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="department" render={({ field }) => (
                        <FormItem><FormLabel>Department *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="sample_type" render={({ field }) => (
                        <FormItem><FormLabel>Sample Type *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>{OOS_SAMPLE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                    </CardContent>
                  </Card>
                )}

                {step === 2 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Product & Batch</CardTitle>
                      <CardDescription>Select product and batch — fields auto-fill from master data</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2">
                      <FormField control={form.control} name="product_name" render={({ field }) => (
                        <FormItem><FormLabel>Product Name *</FormLabel>
                          <Select
                            onValueChange={(v) => {
                              const p = products.find((x) => x.productName === v);
                              field.onChange(v);
                              form.setValue('product_id', p?.id || null);
                              form.setValue('batch_number', '');
                            }}
                            value={field.value}
                          >
                            <FormControl><SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {products.map((p) => <SelectItem key={p.id} value={p.productName}>{p.productName}</SelectItem>)}
                            </SelectContent>
                          </Select><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="batch_number" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Batch Number {requiresBatchNumber(watched.sample_type) ? '*' : ''}</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || undefined}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {batches.map((b) => <SelectItem key={b.id} value={b.batchNumber}>{b.batchNumber}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormDescription>Or type manually below</FormDescription>
                          <FormControl><Input {...field} placeholder="Batch number" className="mt-2" /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </CardContent>
                  </Card>
                )}

                {step === 3 && (
                  <Card>
                    <CardHeader><CardTitle>Test & Specification</CardTitle></CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      <FormField control={form.control} name="test_name" render={({ field }) => (
                        <FormItem><FormLabel>Test Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="parameter_name" render={({ field }) => (
                        <FormItem><FormLabel>Parameter Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="test_method" render={({ field }) => (
                        <FormItem><FormLabel>Test Method *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="stp_number" render={({ field }) => (
                        <FormItem><FormLabel>STP Number *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="specification_number" render={({ field }) => (
                        <FormItem><FormLabel>Specification Number *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="unit" render={({ field }) => (
                        <FormItem><FormLabel>Unit *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="spec_lower_limit" render={({ field }) => (
                        <FormItem><FormLabel>Specification Lower Limit *</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="spec_upper_limit" render={({ field }) => (
                        <FormItem><FormLabel>Specification Upper Limit *</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </CardContent>
                  </Card>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <OosSpecComparisonCard
                      parameterName={watched.parameter_name}
                      lower={Number(watched.spec_lower_limit) || 0}
                      upper={Number(watched.spec_upper_limit) || 0}
                      observed={Number(watched.observed_result) || 0}
                      unit={watched.unit || ''}
                      resultStatus={resultStatus}
                    />
                    <Card>
                      <CardHeader><CardTitle>Result & Observation</CardTitle></CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-2">
                        <FormField control={form.control} name="observed_result" render={({ field }) => (
                          <FormItem><FormLabel>Observed Result *</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="analyst_name" render={({ field }) => (
                          <FormItem><FormLabel>Analyst *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="instrument_used" render={({ field }) => (
                          <FormItem><FormLabel>Instrument Used *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="is_critical_test" render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
                            <div><FormLabel>Critical Test</FormLabel><FormDescription>Sterility, Endotoxin, Assay — notifies Head QA</FormDescription></div>
                            <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="initial_observation" render={({ field }) => (
                          <FormItem className="md:col-span-2"><FormLabel>Initial Observation *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={form.control} name="immediate_action" render={({ field }) => (
                          <FormItem className="md:col-span-2"><FormLabel>Immediate Action *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {step === 5 && (
                  <Card>
                    <CardHeader><CardTitle>Investigation Assignment</CardTitle></CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-2">
                      <FormField control={form.control} name="batch_release_blocked" render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
                          <div><FormLabel>Batch Blocked</FormLabel><FormDescription>Block batch release pending investigation</FormDescription></div>
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="capa_required" render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
                          <div><FormLabel>CAPA Required</FormLabel><FormDescription>{autoRules.capaSuggested ? 'Recommended based on criticality' : 'Mark if CAPA linkage needed'}</FormDescription></div>
                          <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="assigned_investigator_name" render={({ field }) => (
                        <FormItem><FormLabel>Assigned Investigator *</FormLabel>
                          <Select
                            onValueChange={(v) => {
                              const inv = investigators.find((i) => i.name === v);
                              field.onChange(v);
                              form.setValue('assigned_to', inv?.id || null);
                            }}
                            value={field.value}
                          >
                            <FormControl><SelectTrigger><SelectValue placeholder="Select investigator" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {investigators.map((i) => <SelectItem key={i.id} value={i.name}>{i.name}{i.department ? ` (${i.department})` : ''}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormControl><Input {...field} className="mt-2" placeholder="Or enter name manually" /></FormControl>
                          <FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="target_closure_date" render={({ field }) => (
                        <FormItem><FormLabel>Target Closure Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={form.control} name="remarks" render={({ field }) => (
                        <FormItem className="md:col-span-2"><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl></FormItem>
                      )} />
                    </CardContent>
                  </Card>
                )}

                {step === 6 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Attachments & Submit</CardTitle>
                      <CardDescription>Review summary and submit OOS for investigation</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-2 rounded-md border bg-slate-50 p-4 text-sm md:grid-cols-2">
                        <p><span className="text-muted-foreground">OOS No:</span> <span className="font-mono">{previewNumber}</span></p>
                        <p><span className="text-muted-foreground">Product:</span> {watched.product_name}</p>
                        <p><span className="text-muted-foreground">Batch:</span> {watched.batch_number || '—'}</p>
                        <p><span className="text-muted-foreground">Test:</span> {watched.test_name}</p>
                        <p><span className="text-muted-foreground">Result:</span> {resultStatus}</p>
                        <p><span className="text-muted-foreground">Investigator:</span> {watched.assigned_investigator_name}</p>
                      </div>
                      <OosAttachmentPlaceholder onAdd={handleAttachment} disabled={busy} files={attachments} />
                    </CardContent>
                  </Card>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                  <div className="flex gap-2">
                    {step > 1 && (
                      <Button type="button" variant="outline" onClick={handleBack} disabled={busy}>
                        <ArrowLeft className="mr-1 h-4 w-4" /> Back
                      </Button>
                    )}
                    <Button type="button" variant="outline" onClick={() => void handleSaveDraft()} disabled={busy}>
                      {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                      Save Draft
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    {step < STEP_SCHEMAS.length ? (
                      <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleNext()} disabled={busy}>
                        Next <ArrowRight className="ml-1 h-4 w-4" />
                      </Button>
                    ) : (
                      <Button type="button" className="bg-blue-600 hover:bg-blue-700" onClick={() => void handleSubmit()} disabled={busy}>
                        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                        Submit OOS
                      </Button>
                    )}
                  </div>
                </div>
              </form>
            </Form>
          </>
        )}
      </div>
    </OosCreateAccessGuard>
  );
}

function mapPrefill(pre: import('@/lib/oos-create-records').OosSourcePrefill): Partial<OosCreateInput> {
  return {
    oos_date: pre.oosDate,
    department: pre.department,
    product_name: pre.productName,
    batch_number: pre.batchNumber,
    test_name: pre.testName,
    parameter_name: pre.parameterName,
    stp_number: pre.stpNumber,
    specification_number: pre.specificationNumber,
    spec_lower_limit: pre.specLowerLimit,
    spec_upper_limit: pre.specUpperLimit,
    observed_result: pre.observedResult,
    unit: pre.unit,
    analyst_name: pre.analystName,
    sample_type: (pre.sampleType as OosCreateInput['sample_type']) || 'Finished Product',
    test_method: 'CPV Monitoring',
  };
}
