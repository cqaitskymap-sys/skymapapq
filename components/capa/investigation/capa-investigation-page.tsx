'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle, ArrowLeft, Loader2, Paperclip, Save, Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  canApproveCriticalCapaInvestigation,
  canEditCapaInvestigation,
  canReviewCapaInvestigation,
  computeInvestigationAutoRules,
  isCapaInvestigationReadOnly,
  isInvestigationApproved,
  mapAuditToCapaInvestigationTimeline,
  mapInvestigationToForm,
} from '@/lib/capa-investigation-records';
import {
  addCapaInvestigationEvidence,
  closeCapaInvestigation,
  fetchCapaInvestigationPageData,
  reviewCapaInvestigation,
  saveCapaInvestigationDraft,
  startCapaInvestigation,
  submitCapaInvestigationForQaReview,
  updateCapaFishbone,
  updateCapaFiveWhy,
  uploadCapaInvestigationAttachmentPlaceholder,
} from '@/lib/capa-investigation-service';
import {
  capaInvestigationQaReviewSchema,
  capaInvestigationSchema,
  type CapaInvestigationInput,
} from '@/lib/capa-investigation-schemas';
import { CAPA_RCA_CATEGORIES, CAPA_RCA_METHODS, type CapaInvestigation, type CapaRecord } from '@/lib/capa-types';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { CapaStatusBadge, CapaPriorityBadge } from '@/components/capa/capa-sub-nav';
import { CapaInvestigationAccessGuard } from './capa-investigation-access-guard';
import { CapaInvestigationStatusBadge } from './capa-investigation-status-badge';
import { CapaRcaCategoryBadge, CapaRiskBadge } from './capa-rca-badges';
import { CapaFiveWhyWorksheet } from './capa-five-why-worksheet';
import { CapaFishboneSection } from './capa-fishbone-section';
import { CapaInvestigationTimeline } from './capa-investigation-timeline';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function CapaInvestigationPage({ capaId }: { capaId: string }) {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capa, setCapa] = useState<CapaRecord | null>(null);
  const [investigation, setInvestigation] = useState<CapaInvestigation | null>(null);
  const [auditLogs, setAuditLogs] = useState<Record<string, unknown>[]>([]);
  const [evidenceName, setEvidenceName] = useState('');
  const [evidenceDesc, setEvidenceDesc] = useState('');

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: profile?.role,
    department: profile?.department,
    email: profile?.email,
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role, profile?.department]);

  const readOnly = isCapaInvestigationReadOnly(actor.role);
  const canEdit = capa ? canEditCapaInvestigation(actor.role, capa, actor.id) : false;
  const canReview = canReviewCapaInvestigation(actor.role);
  const canApproveCritical = canApproveCriticalCapaInvestigation(actor.role, capa?.priority);
  const editable = canEdit && !readOnly && !isInvestigationApproved(investigation?.status);

  const form = useForm<CapaInvestigationInput>({
    resolver: zodResolver(capaInvestigationSchema),
    defaultValues: { capa_id: capaId, problem_statement: '', root_cause_method: '5 Why Analysis', root_cause_category: 'Process', root_cause_description: '', investigation_conclusion: '', investigator: '', investigation_date: '', department: '' },
  });

  const qaForm = useForm<{ decision: 'approved' | 'rejected'; qa_review_comments: string }>({
    resolver: zodResolver(capaInvestigationQaReviewSchema),
    defaultValues: { decision: 'approved', qa_review_comments: '' },
  });

  const watchAll = form.watch();
  const autoRules = useMemo(() => computeInvestigationAutoRules(watchAll, capa || undefined), [watchAll, capa]);
  const timeline = useMemo(() => mapAuditToCapaInvestigationTimeline(auditLogs), [auditLogs]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await fetchCapaInvestigationPageData(capaId);
    if ('error' in data && data.error) {
      setError(data.error);
      setLoading(false);
      return;
    }
    if (!data.capa) {
      setError('CAPA record not found.');
      setLoading(false);
      return;
    }
    setCapa(data.capa);
    setInvestigation(data.investigation || null);
    setAuditLogs(data.auditLogs || []);
    form.reset(mapInvestigationToForm(data.investigation, data.capa));
    if (data.investigation?.qa_review_comments) {
      qaForm.setValue('qa_review_comments', data.investigation.qa_review_comments);
    }
    setLoading(false);
  }, [capaId, form, qaForm]);

  useEffect(() => { void load(); }, [load]);

  const handleSaveDraft = async () => {
    setBusy(true);
    try {
      const saved = await saveCapaInvestigationDraft(form.getValues(), actor);
      setInvestigation(saved);
      toast.success('Investigation draft saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async () => {
    setBusy(true);
    try {
      const saved = await startCapaInvestigation(form.getValues(), actor);
      setInvestigation(saved);
      toast.success('Investigation started');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitQa = form.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const saved = await submitCapaInvestigationForQaReview(values, actor);
      setInvestigation(saved);
      toast.success('Submitted for QA review');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  });

  const handleFiveWhySave = async () => {
    const fiveWhy = form.getValues('five_why');
    if (!fiveWhy) return;
    setBusy(true);
    try {
      const saved = await updateCapaFiveWhy(capaId, {
        why1: fiveWhy.why1 || '',
        why2: fiveWhy.why2 || '',
        why3: fiveWhy.why3 || '',
        why4: fiveWhy.why4 || '',
        why5: fiveWhy.why5 || '',
        final_root_cause: fiveWhy.final_root_cause || '',
      }, actor);
      setInvestigation(saved);
      if (fiveWhy.final_root_cause) form.setValue('root_cause_description', fiveWhy.final_root_cause);
      toast.success('5 Why analysis saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleFishboneSave = async () => {
    const fishbone = form.getValues('fishbone');
    if (!fishbone) return;
    setBusy(true);
    try {
      const saved = await updateCapaFishbone(capaId, {
        Man: fishbone.Man || '',
        Machine: fishbone.Machine || '',
        Method: fishbone.Method || '',
        Material: fishbone.Material || '',
        Measurement: fishbone.Measurement || '',
        Environment: fishbone.Environment || '',
      }, actor);
      setInvestigation(saved);
      toast.success('Fishbone analysis saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleAddEvidence = async () => {
    if (!evidenceName.trim()) return toast.message('Evidence name is required');
    setBusy(true);
    try {
      const saved = await addCapaInvestigationEvidence(capaId, { name: evidenceName, description: evidenceDesc }, actor);
      setInvestigation(saved);
      setEvidenceName('');
      setEvidenceDesc('');
      toast.success('Evidence added');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add evidence');
    } finally {
      setBusy(false);
    }
  };

  const handleAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await uploadCapaInvestigationAttachmentPlaceholder(capaId, file.name, actor);
      toast.success('Attachment uploaded');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleQaReview = qaForm.handleSubmit(async (data) => {
    setBusy(true);
    try {
      const saved = await reviewCapaInvestigation(capaId, data, actor);
      setInvestigation(saved);
      toast.success(data.decision === 'approved' ? 'Investigation approved' : 'Investigation rejected');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  });

  const handleClose = async () => {
    setBusy(true);
    try {
      const saved = await closeCapaInvestigation(capaId, actor);
      setInvestigation(saved);
      toast.success('Investigation closed');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Close failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error || !capa) return <ErrorCard title="Unable to load investigation" message={error || 'CAPA not found'} />;

  return (
    <CapaInvestigationAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="CAPA Investigation & RCA"
          description="Perform GMP-compliant investigation and root cause analysis before corrective and preventive action implementation"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/capa' },
            { label: 'CAPA Management', href: '/qms/capa' },
            { label: 'Investigation & RCA', href: '/qms/capa/investigation' },
            { label: capa.capa_number },
          ]}
          actions={(
            <Link href={`/qms/capa/${capaId}`}>
              <Button variant="outline" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" />Back to CAPA</Button>
            </Link>
          )}
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{capa.capa_number}</span>
          <CapaStatusBadge status={capa.capa_status} />
          <CapaPriorityBadge priority={capa.priority} />
          <CapaInvestigationStatusBadge status={investigation?.status} />
          {investigation?.investigation_id && (
            <span className="text-xs text-muted-foreground font-mono">INV: {investigation.investigation_id}</span>
          )}
        </div>

        {autoRules.warnings.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Investigation requirements</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 mt-1 space-y-1">
                {autoRules.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {autoRules.recommendations.length > 0 && (
          <Alert>
            <AlertTitle>Auto recommendations</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4 mt-1 space-y-1">
                {autoRules.recommendations.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="overview">
          <TabsList className="flex h-auto flex-wrap">
            {['overview', 'five-why', 'fishbone', 'evidence', 'risk', 'qa-review', 'audit'].map((t) => (
              <TabsTrigger key={t} value={t} className="capitalize">{t.replace('-', ' ')}</TabsTrigger>
            ))}
          </TabsList>

          <Form {...form}>
            <TabsContent value="overview" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Investigation Overview</CardTitle>
                  <CardDescription>Problem statement, containment, and RCA summary</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormField control={form.control} name="investigation_date" render={({ field }) => (
                      <FormItem><FormLabel>Investigation Date *</FormLabel><FormControl><Input type="date" {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="investigator" render={({ field }) => (
                      <FormItem><FormLabel>Investigator *</FormLabel><FormControl><Input {...field} disabled={!editable} placeholder="User ID or name" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="department" render={({ field }) => (
                      <FormItem><FormLabel>Department *</FormLabel><FormControl><Input {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="root_cause_method" render={({ field }) => (
                      <FormItem><FormLabel>Root Cause Method *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={!editable}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{CAPA_RCA_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="root_cause_category" render={({ field }) => (
                      <FormItem><FormLabel>Root Cause Category</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value} disabled={!editable}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>{CAPA_RCA_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select><FormMessage /></FormItem>
                    )} />
                    <div className="flex items-end"><CapaRcaCategoryBadge category={form.watch('root_cause_category')} /></div>
                  </div>

                  <FormField control={form.control} name="problem_statement" render={({ field }) => (
                    <FormItem><FormLabel>Problem Statement *</FormLabel><FormControl><Textarea rows={3} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="observed_issue" render={({ field }) => (
                    <FormItem><FormLabel>Observed Issue</FormLabel><FormControl><Textarea rows={2} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="issue_description" render={({ field }) => (
                    <FormItem><FormLabel>Issue Description</FormLabel><FormControl><Textarea rows={3} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="immediate_containment_action" render={({ field }) => (
                    <FormItem><FormLabel>Immediate Containment Action</FormLabel><FormControl><Textarea rows={2} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="root_cause_description" render={({ field }) => (
                    <FormItem><FormLabel>Root Cause Description *</FormLabel><FormControl><Textarea rows={3} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="contributing_factors" render={({ field }) => (
                    <FormItem><FormLabel>Contributing Factors</FormLabel><FormControl><Textarea rows={2} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="investigation_conclusion" render={({ field }) => (
                    <FormItem><FormLabel>Investigation Conclusion *</FormLabel><FormControl><Textarea rows={3} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="corrective_action_recommendation" render={({ field }) => (
                      <FormItem><FormLabel>Corrective Action Recommendation</FormLabel><FormControl><Textarea rows={2} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="preventive_action_recommendation" render={({ field }) => (
                      <FormItem><FormLabel>Preventive Action Recommendation</FormLabel><FormControl><Textarea rows={2} {...field} disabled={!editable} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>

                  {editable && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button type="button" variant="outline" disabled={busy} onClick={handleSaveDraft} className="gap-1">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Draft
                      </Button>
                      <Button type="button" disabled={busy} onClick={handleStart} className="gap-1 bg-blue-600 hover:bg-blue-700">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Start Investigation
                      </Button>
                      <Button type="button" disabled={busy} onClick={handleSubmitQa} className="gap-1">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit for QA Review
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="five-why" className="mt-4">
              <Card>
                <CardHeader><CardTitle className="text-base">5 Why Analysis</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <CapaFiveWhyWorksheet
                    value={form.watch('five_why')}
                    onChange={(v) => form.setValue('five_why', v)}
                    disabled={!editable}
                  />
                  {editable && (
                    <Button type="button" disabled={busy} onClick={handleFiveWhySave}>Save 5 Why Worksheet</Button>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="fishbone" className="mt-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Fishbone Analysis</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <CapaFishboneSection
                    value={form.watch('fishbone')}
                    onChange={(v) => form.setValue('fishbone', v)}
                    disabled={!editable}
                  />
                  {editable && (
                    <Button type="button" disabled={busy} onClick={handleFishboneSave}>Save Fishbone Analysis</Button>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Form>

          <TabsContent value="evidence" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Evidence Review</CardTitle>
                  <CardDescription>Document supporting evidence for RCA conclusions</CardDescription>
                </div>
                {editable && (
                  <label className="cursor-pointer">
                    <Button variant="outline" size="sm" className="gap-1" asChild><span><Paperclip className="h-4 w-4" />Attachment</span></Button>
                    <input type="file" className="hidden" onChange={handleAttachment} />
                  </label>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <Form {...form}>
                  <FormField control={form.control} name="evidence_summary" render={({ field }) => (
                    <FormItem><FormLabel>Evidence Summary</FormLabel><FormControl><Textarea rows={3} {...field} disabled={!editable} onBlur={() => { if (editable) void handleSaveDraft(); }} /></FormControl></FormItem>
                  )} />
                </Form>
                {editable && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end border-t pt-4">
                    <div><label className="text-xs text-muted-foreground">Evidence Name</label><Input value={evidenceName} onChange={(e) => setEvidenceName(e.target.value)} /></div>
                    <div className="md:col-span-2"><label className="text-xs text-muted-foreground">Description</label><Input value={evidenceDesc} onChange={(e) => setEvidenceDesc(e.target.value)} /></div>
                    <Button type="button" disabled={busy} onClick={handleAddEvidence}>Add Evidence</Button>
                  </div>
                )}
                <ul className="space-y-2 text-sm">
                  {(investigation?.evidence_items || []).length === 0 ? (
                    <li className="text-muted-foreground">No evidence items recorded.</li>
                  ) : investigation?.evidence_items.map((ev) => (
                    <li key={ev.id} className="rounded border p-2">
                      <strong>{ev.name}</strong> — {ev.description}
                      <span className="block text-xs text-muted-foreground">{ev.added_by_name} · {new Date(ev.added_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="risk" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Risk Assessment</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <Form {...form}>
                  <FormField control={form.control} name="risk_assessment_result" render={({ field }) => (
                    <FormItem><FormLabel>Risk Assessment Result</FormLabel><FormControl><Textarea rows={4} {...field} disabled={!editable} placeholder="Document risk level, impact, and residual risk after containment" /></FormControl></FormItem>
                  )} />
                </Form>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">CAPA Priority Risk:</span>
                  <CapaRiskBadge level={capa.criticality || capa.priority} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="qa-review" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">QA Review</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {investigation?.qa_review_comments && (
                  <p className="text-sm"><span className="text-muted-foreground">Previous QA comments: </span>{investigation.qa_review_comments}</p>
                )}
                {canReview && investigation?.status === 'qa_review' && canApproveCritical && !readOnly ? (
                  <Form {...qaForm}>
                    <form onSubmit={handleQaReview} className="space-y-4">
                      <FormField control={qaForm.control} name="qa_review_comments" render={({ field }) => (
                        <FormItem><FormLabel>QA Review Comments *</FormLabel><FormControl><Textarea rows={3} {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="flex gap-2">
                        <Button type="submit" disabled={busy} onClick={() => qaForm.setValue('decision', 'approved')}>Approve RCA</Button>
                        <Button type="button" variant="destructive" disabled={busy} onClick={qaForm.handleSubmit(async (data) => {
                          await reviewCapaInvestigation(capaId, { ...data, decision: 'rejected' }, actor);
                          toast.success('Investigation rejected');
                          await load();
                        })}>Reject RCA</Button>
                      </div>
                    </form>
                  </Form>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {investigation?.status === 'qa_review' && !canApproveCritical
                      ? 'Head QA approval required for critical CAPA RCA.'
                      : 'QA review available when investigation is submitted for review.'}
                  </p>
                )}
                {isInvestigationApproved(investigation?.status) && canReview && (
                  <Button variant="outline" disabled={busy || investigation?.status === 'closed'} onClick={handleClose}>
                    Close Investigation
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
              <CardContent>
                <CapaInvestigationTimeline entries={timeline} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </CapaInvestigationAccessGuard>
  );
}
