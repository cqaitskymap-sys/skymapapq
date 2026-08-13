'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft, Calendar, CheckCircle2, Loader2, Paperclip, Save, Send, ShieldCheck, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  canApproveCapaEffectiveness,
  canApproveCriticalCapaEffectiveness,
  canCreateCapaEffectiveness,
  canProvideEffectivenessEvidence,
  computeAutoEffectivenessResult,
  computeEffectivenessScore,
  hasOpenCorrectiveOrPreventiveActions,
  isCapaEffectivenessReadOnly,
  mapAuditToEffectivenessTimeline,
} from '@/lib/capa-effectiveness-records';
import {
  closeCapaEffectivenessReview,
  fetchCapaEffectivenessPageData,
  initiateCapaEffectivenessReassessment,
  reviewCapaEffectiveness,
  saveCapaEffectivenessDraft,
  scheduleCapaEffectivenessReview,
  submitCapaEffectivenessForQaReview,
  uploadCapaEffectivenessEvidencePlaceholder,
} from '@/lib/capa-effectiveness-service';
import {
  CAPA_EFF_CRITERIA_OPTIONS,
  capaEffectivenessQaReviewSchema,
  capaEffectivenessReviewSchema,
  capaEffectivenessScheduleSchema,
  type CapaEffectivenessReviewInput,
} from '@/lib/capa-effectiveness-schemas';
import { CAPA_DEPARTMENTS, type CapaEffectiveness, type CapaRecord } from '@/lib/capa-types';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { CapaStatusBadge, CapaPriorityBadge } from '@/components/capa/capa-sub-nav';
import { CapaEffectivenessAccessGuard } from './capa-effectiveness-access-guard';
import {
  CapaEffectivenessResultBadge,
  CapaEffectivenessScoreBadge,
  CapaEffectivenessStatusBadge,
} from './capa-effectiveness-badges';
import { CapaEffectivenessProgress } from './capa-effectiveness-progress';
import { CapaEffectivenessTimeline } from './capa-effectiveness-timeline';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function CapaEffectivenessPage({ capaId }: { capaId: string }) {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capa, setCapa] = useState<CapaRecord | null>(null);
  const [review, setReview] = useState<CapaEffectiveness | null>(null);
  const [auditLogs, setAuditLogs] = useState<Record<string, unknown>[]>([]);
  const [openActions, setOpenActions] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState('');

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'User',
    role: profile?.role,
    department: profile?.department,
  }), [user?.uid, profile?.full_name, profile?.email, profile?.role, profile?.department]);

  const readOnly = isCapaEffectivenessReadOnly(actor.role);
  const canCreate = canCreateCapaEffectiveness(actor.role) && !readOnly;
  const canApprove = canApproveCapaEffectiveness(actor.role) && !readOnly;
  const canApproveCritical = capa ? canApproveCriticalCapaEffectiveness(actor.role, capa.priority) : false;
  const canEvidence = capa ? canProvideEffectivenessEvidence(actor.role, capa, actor.id) : false;

  const scheduleForm = useForm<{ effectiveness_due_date: string; review_period: string }>({
    resolver: zodResolver(capaEffectivenessScheduleSchema.omit({ capa_id: true })),
    defaultValues: { effectiveness_due_date: '', review_period: '90 days post-implementation' },
  });

  const reviewForm = useForm<CapaEffectivenessReviewInput>({
    resolver: zodResolver(capaEffectivenessReviewSchema),
    defaultValues: {
      capa_id: capaId,
      effectiveness_due_date: '',
      effectiveness_review_date: new Date().toISOString().split('T')[0],
      reviewed_by: user?.uid || '',
      reviewed_by_name: profile?.full_name || '',
      department: profile?.department || 'QA',
      review_period: '90 days post-implementation',
      evaluation_criteria: [],
      evidence_reviewed: '',
      data_reviewed: '',
      repeat_issue_observed: false,
      issue_reoccurred: false,
      risk_reduced: false,
      root_cause_eliminated: false,
      corrective_action_effective: true,
      preventive_action_effective: true,
      qa_comments: '',
      final_conclusion: '',
    },
  });

  const qaForm = useForm<{ decision: 'approved' | 'rejected'; qa_comments: string; head_qa_comments: string }>({
    resolver: zodResolver(capaEffectivenessQaReviewSchema),
    defaultValues: { decision: 'approved', qa_comments: '', head_qa_comments: '' },
  });

  const watched = reviewForm.watch();
  const computedScore = useMemo(() => computeEffectivenessScore(watched), [watched]);
  const computedResult = useMemo(() => computeAutoEffectivenessResult({ ...watched, effectiveness_score: computedScore }), [watched, computedScore]);
  const timeline = useMemo(() => mapAuditToEffectivenessTimeline(auditLogs), [auditLogs]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await fetchCapaEffectivenessPageData(capaId);
    if ('error' in data && data.error) {
      setError(data.error);
      setLoading(false);
      return;
    }
    if (!data.capa) {
      setError('CAPA not found');
      setLoading(false);
      return;
    }
    setCapa(data.capa);
    setReview(data.review || null);
    setAuditLogs(data.auditLogs || []);
    setOpenActions(hasOpenCorrectiveOrPreventiveActions(data.correctiveActions || [], data.preventiveActions || []));

    reviewForm.reset({
      capa_id: capaId,
      effectiveness_due_date: data.review?.effectiveness_due_date || data.capa.effectiveness_check_date || '',
      effectiveness_review_date: data.review?.effectiveness_review_date || data.review?.check_date || new Date().toISOString().split('T')[0],
      reviewed_by: data.review?.reviewed_by || user?.uid || '',
      reviewed_by_name: data.review?.reviewed_by_name || profile?.full_name || '',
      department: data.review?.department || data.capa.department || 'QA',
      review_period: data.review?.review_period || '90 days post-implementation',
      evaluation_criteria: data.review?.evaluation_criteria || [],
      evidence_reviewed: data.review?.evidence_reviewed || data.review?.evidence || '',
      data_reviewed: data.review?.data_reviewed || '',
      repeat_issue_observed: data.review?.repeat_issue_observed ?? false,
      issue_reoccurred: data.review?.issue_reoccurred ?? false,
      risk_reduced: data.review?.risk_reduced ?? false,
      root_cause_eliminated: data.review?.root_cause_eliminated ?? false,
      corrective_action_effective: data.review?.corrective_action_effective ?? true,
      preventive_action_effective: data.review?.preventive_action_effective ?? true,
      effectiveness_result: data.review?.effectiveness_result || data.review?.result,
      effectiveness_score: data.review?.effectiveness_score,
      qa_comments: data.review?.qa_comments || '',
      final_conclusion: data.review?.final_conclusion || data.review?.remarks || '',
    });
    setLoading(false);
  }, [capaId, reviewForm, user?.uid, profile?.full_name]);

  useEffect(() => { void load(); }, [load]);

  const gateBlocked = !capa?.effectiveness_check_required || openActions
    || !['implemented', 'effectiveness_pending', 'effectiveness_completed', 'approved', 'qa_review'].includes(capa?.capa_status || '');

  const handleSchedule = scheduleForm.handleSubmit(async (values) => {
    setBusy(true);
    try {
      await scheduleCapaEffectivenessReview(capaId, values, actor);
      toast.success('Effectiveness review scheduled');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Schedule failed');
    } finally { setBusy(false); }
  });

  const handleSaveDraft = reviewForm.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const payload = { ...values, effectiveness_score: computedScore, effectiveness_result: computedResult };
      await saveCapaEffectivenessDraft(payload, actor);
      toast.success('Draft saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally { setBusy(false); }
  });

  const handleSubmitQa = reviewForm.handleSubmit(async (values) => {
    setBusy(true);
    try {
      const payload = { ...values, effectiveness_score: computedScore, effectiveness_result: computedResult };
      await submitCapaEffectivenessForQaReview(payload, actor);
      toast.success('Submitted for QA review');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submit failed');
    } finally { setBusy(false); }
  });

  const handleQaDecision = qaForm.handleSubmit(async (values) => {
    setBusy(true);
    try {
      await reviewCapaEffectiveness(capaId, values, actor);
      toast.success(`Effectiveness ${values.decision}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Review failed');
    } finally { setBusy(false); }
  });

  const handleReassessment = async () => {
    setBusy(true);
    try {
      await initiateCapaEffectivenessReassessment(capaId, actor);
      toast.success('Reassessment initiated');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  };

  const handleClose = async () => {
    setBusy(true);
    try {
      await closeCapaEffectivenessReview(capaId, actor);
      toast.success('Effectiveness review closed');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Close failed');
    } finally { setBusy(false); }
  };

  const handleEvidenceUpload = async () => {
    if (!evidenceFile.trim()) return toast.error('Enter evidence file name or description');
    setBusy(true);
    try {
      await uploadCapaEffectivenessEvidencePlaceholder(capaId, evidenceFile, evidenceFile, actor);
      toast.success('Evidence uploaded');
      setEvidenceFile('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally { setBusy(false); }
  };

  return (
    <CapaEffectivenessAccessGuard>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <Link href="/qms/capa/effectiveness-check">
            <Button variant="ghost" size="sm" className="gap-1 mt-1"><ArrowLeft className="h-4 w-4" />Back</Button>
          </Link>
          <div className="flex-1">
            <CpvPageHeader
              title={`Effectiveness Check — ${capa?.capa_number || capaId}`}
              description={capa?.capa_title || 'Evaluate CAPA action effectiveness'}
              trail={[
                { label: 'Dashboard', href: '/dashboard' },
                { label: 'QMS', href: '/qms/capa' },
                { label: 'Effectiveness Check', href: '/qms/capa/effectiveness-check' },
                { label: capa?.capa_number || capaId },
              ]}
            />
          </div>
        </div>

        {loading ? <LoadingSkeleton rows={4} /> : error ? (
          <ErrorCard title="Load error" message={error} />
        ) : capa ? (
          <>
            {gateBlocked && (
              <Alert variant="destructive">
                <AlertTitle>Effectiveness check not available</AlertTitle>
                <AlertDescription>
                  {!capa.effectiveness_check_required && 'Effectiveness check is not required for this CAPA.'}
                  {openActions && ' All corrective and preventive actions must be closed first.'}
                  {!openActions && !['implemented', 'effectiveness_pending', 'effectiveness_completed', 'approved', 'qa_review'].includes(capa.capa_status)
                    && ' CAPA must be implemented before effectiveness review.'}
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">CAPA Status</p><CapaStatusBadge status={capa.capa_status} /></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Review Status</p><CapaEffectivenessStatusBadge status={review?.status} /></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Result</p><CapaEffectivenessResultBadge result={review?.effectiveness_result || review?.result || computedResult} /></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Score</p><CapaEffectivenessScoreBadge score={review?.effectiveness_score ?? computedScore} /></CardContent></Card>
            </div>

            {review && <CapaEffectivenessProgress review={review} />}

            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="flex flex-wrap h-auto gap-1">
                {['overview', 'checklist', 'evidence', 'risk', 'qa-review', 'approval', 'timeline', 'audit'].map((t) => (
                  <TabsTrigger key={t} value={t} className="capitalize text-xs sm:text-sm">
                    {t === 'checklist' ? 'Evaluation Checklist' : t === 'qa-review' ? 'QA Review' : t === 'audit' ? 'Audit Trail' : t.replace('-', ' ')}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader><CardTitle className="text-base">CAPA Summary</CardTitle></CardHeader>
                    <CardContent className="text-sm space-y-2">
                      <p><span className="text-muted-foreground">Number:</span> <span className="font-mono">{capa.capa_number}</span></p>
                      <p><span className="text-muted-foreground">Source:</span> {capa.capa_source} ({capa.source_reference_number})</p>
                      <p><span className="text-muted-foreground">Department:</span> {capa.department}</p>
                      <p><span className="text-muted-foreground">Priority:</span> <CapaPriorityBadge priority={capa.priority} /></p>
                      <p><span className="text-muted-foreground">Owner:</span> {capa.action_owner_name || capa.action_owner}</p>
                      <p><span className="text-muted-foreground">Root Cause:</span> {capa.root_cause || '—'}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle className="text-base">Review Summary</CardTitle></CardHeader>
                    <CardContent className="text-sm space-y-2">
                      <p><span className="text-muted-foreground">Review ID:</span> {review?.effectiveness_id || 'Not scheduled'}</p>
                      <p><span className="text-muted-foreground">Due Date:</span> {review?.effectiveness_due_date || '—'}</p>
                      <p><span className="text-muted-foreground">Review Date:</span> {review?.effectiveness_review_date || review?.check_date || '—'}</p>
                      <p><span className="text-muted-foreground">Reviewed By:</span> {review?.reviewed_by_name || review?.checked_by_name || '—'}</p>
                      <p><span className="text-muted-foreground">Review Period:</span> {review?.review_period || '—'}</p>
                      {review?.new_capa_recommended && (
                        <p className="text-red-600 font-medium flex items-center gap-1"><XCircle className="h-4 w-4" />New CAPA recommended</p>
                      )}
                      {review?.capa_closure_recommended && (
                        <p className="text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-4 w-4" />CAPA recommended for closure</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {canCreate && !gateBlocked && (
                  <Card>
                    <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calendar className="h-4 w-4" />Schedule Review</CardTitle></CardHeader>
                    <CardContent>
                      <Form {...scheduleForm}>
                        <form onSubmit={handleSchedule} className="flex flex-wrap gap-3 items-end">
                          <FormField control={scheduleForm.control} name="effectiveness_due_date" render={({ field }) => (
                            <FormItem><FormLabel>Due Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
                          )} />
                          <FormField control={scheduleForm.control} name="review_period" render={({ field }) => (
                            <FormItem className="min-w-[200px]"><FormLabel>Review Period</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
                          )} />
                          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Schedule'}</Button>
                        </form>
                      </Form>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="checklist" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Evaluation Checklist</CardTitle>
                    <CardDescription>Select criteria verified during the effectiveness review period</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...reviewForm}>
                      <form className="space-y-4">
                        <FormField control={reviewForm.control} name="evaluation_criteria" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Evaluation Criteria *</FormLabel>
                            <div className="grid sm:grid-cols-2 gap-2 mt-2">
                              {CAPA_EFF_CRITERIA_OPTIONS.map((c) => (
                                <label key={c} className="flex items-center gap-2 text-sm rounded border p-2 cursor-pointer hover:bg-muted/50">
                                  <Checkbox
                                    checked={field.value?.includes(c)}
                                    onCheckedChange={(checked) => {
                                      const next = checked ? [...(field.value || []), c] : (field.value || []).filter((x) => x !== c);
                                      field.onChange(next);
                                    }}
                                  />
                                  {c}
                                </label>
                              ))}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <div className="grid sm:grid-cols-2 gap-4">
                          {([
                            ['repeat_issue_observed', 'Repeat issue observed'],
                            ['issue_reoccurred', 'Issue reoccurred'],
                            ['root_cause_eliminated', 'Root cause eliminated'],
                            ['risk_reduced', 'Risk reduced'],
                            ['corrective_action_effective', 'Corrective action effective'],
                            ['preventive_action_effective', 'Preventive action effective'],
                          ] as const).map(([key, label]) => (
                            <FormField key={key} control={reviewForm.control} name={key} render={({ field }) => (
                              <FormItem className="flex items-center justify-between rounded border p-3">
                                <FormLabel className="font-normal">{label}</FormLabel>
                                <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} disabled={readOnly || (!canCreate && !canEvidence)} /></FormControl>
                              </FormItem>
                            )} />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2 items-center p-3 rounded bg-muted/40">
                          <span className="text-sm">Auto-computed:</span>
                          <CapaEffectivenessResultBadge result={computedResult} />
                          <CapaEffectivenessScoreBadge score={computedScore} />
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="evidence" className="mt-4 space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Evidence Review</CardTitle></CardHeader>
                  <CardContent>
                    <Form {...reviewForm}>
                      <div className="space-y-4">
                        <FormField control={reviewForm.control} name="evidence_reviewed" render={({ field }) => (
                          <FormItem><FormLabel>Evidence Reviewed *</FormLabel><FormControl><Textarea rows={4} {...field} disabled={readOnly || (!canCreate && !canEvidence)} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={reviewForm.control} name="data_reviewed" render={({ field }) => (
                          <FormItem><FormLabel>Data Reviewed</FormLabel><FormControl><Textarea rows={3} {...field} disabled={readOnly || (!canCreate && !canEvidence)} /></FormControl></FormItem>
                        )} />
                        <FormField control={reviewForm.control} name="final_conclusion" render={({ field }) => (
                          <FormItem><FormLabel>Final Conclusion *</FormLabel><FormControl><Textarea rows={3} {...field} disabled={readOnly || !canCreate} /></FormControl><FormMessage /></FormItem>
                        )} />
                      </div>
                    </Form>
                    {(canCreate || canEvidence) && !readOnly && (
                      <div className="mt-4 flex flex-wrap gap-2 items-end border-t pt-4">
                        <Input placeholder="Evidence file name or reference" value={evidenceFile} onChange={(e) => setEvidenceFile(e.target.value)} className="max-w-sm" />
                        <Button type="button" variant="outline" onClick={handleEvidenceUpload} disabled={busy} className="gap-1">
                          <Paperclip className="h-4 w-4" />Log Evidence
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="risk" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Risk Reduction Assessment</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-3">
                    <p><strong>Risk Reduced:</strong> {watched.risk_reduced ? 'Yes' : 'No'}</p>
                    <p><strong>Root Cause Eliminated:</strong> {watched.root_cause_eliminated ? 'Yes' : 'No'}</p>
                    <p><strong>Repeat Issue:</strong> {(watched.repeat_issue_observed || watched.issue_reoccurred) ? 'Yes — marks Not Effective' : 'No recurrence observed'}</p>
                    <p className="text-muted-foreground">Risk reduction and recurrence assessment drive auto-scoring and effectiveness result determination per GMP procedure.</p>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="qa-review" className="mt-4 space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">QA Review</CardTitle></CardHeader>
                  <CardContent>
                    <Form {...reviewForm}>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <FormField control={reviewForm.control} name="effectiveness_review_date" render={({ field }) => (
                          <FormItem><FormLabel>Review Date *</FormLabel><FormControl><Input type="date" {...field} disabled={readOnly || !canCreate} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={reviewForm.control} name="department" render={({ field }) => (
                          <FormItem><FormLabel>Department</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange} disabled={readOnly || !canCreate}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>{CAPA_DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                        <FormField control={reviewForm.control} name="reviewed_by" render={({ field }) => (
                          <FormItem><FormLabel>Reviewer ID *</FormLabel><FormControl><Input {...field} disabled={readOnly || !canCreate} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <FormField control={reviewForm.control} name="qa_comments" render={({ field }) => (
                          <FormItem className="sm:col-span-2"><FormLabel>QA Comments</FormLabel><FormControl><Textarea rows={2} {...field} disabled={readOnly || !canCreate} /></FormControl></FormItem>
                        )} />
                      </div>
                    </Form>
                    {canCreate && !gateBlocked && (
                      <div className="flex flex-wrap gap-2 mt-4 border-t pt-4">
                        <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={busy} className="gap-1">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Draft
                        </Button>
                        <Button type="button" onClick={handleSubmitQa} disabled={busy} className="gap-1">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Submit for QA Review
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="approval" className="mt-4 space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Head QA Approval</CardTitle>
                    <CardDescription>
                      {capa.priority === 'critical' ? 'Critical CAPA requires Head QA approval' : 'QA approval for effectiveness review'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {review?.status === 'qa_review' && canApprove ? (
                      <Form {...qaForm}>
                        <form onSubmit={handleQaDecision} className="space-y-4">
                          {!canApproveCritical && capa.priority === 'critical' && (
                            <Alert><AlertDescription>Head QA approval required for critical CAPA.</AlertDescription></Alert>
                          )}
                          <FormField control={qaForm.control} name="decision" render={({ field }) => (
                            <FormItem><FormLabel>Decision</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                  <SelectItem value="approved">Approved</SelectItem>
                                  <SelectItem value="rejected">Rejected</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )} />
                          <FormField control={qaForm.control} name="qa_comments" render={({ field }) => (
                            <FormItem><FormLabel>QA Comments *</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
                          )} />
                          {capa.priority === 'critical' && (
                            <FormField control={qaForm.control} name="head_qa_comments" render={({ field }) => (
                              <FormItem><FormLabel>Head QA Comments</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
                            )} />
                          )}
                          <Button type="submit" disabled={busy || !canApproveCritical} className="gap-1">
                            <ShieldCheck className="h-4 w-4" />Submit Decision
                          </Button>
                        </form>
                      </Form>
                    ) : review?.status === 'approved' ? (
                      <div className="space-y-3">
                        <p className="text-green-700 flex items-center gap-2"><CheckCircle2 className="h-5 w-5" />Effectiveness review approved</p>
                        {canApprove && (
                          <Button onClick={handleClose} disabled={busy} variant="outline">Close Review</Button>
                        )}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-sm">Approval available when review is in QA Review status.</p>
                    )}
                    {review?.status === 'reassessment_required' && canCreate && (
                      <Button onClick={handleReassessment} disabled={busy} variant="destructive" className="mt-4">Initiate Reassessment</Button>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="timeline" className="mt-4">
                <Card><CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
                  <CardContent><CapaEffectivenessTimeline entries={timeline} /></CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="audit" className="mt-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
                  <CardContent>
                    {auditLogs.length ? (
                      <Table>
                        <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>User</TableHead><TableHead>Date</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {auditLogs.filter((l) => /effectiveness|evaluation|reassessment|evidence|approve|reject|schedule|closure/i.test(String(l.actionType || l.action || ''))).map((l) => (
                            <TableRow key={String(l.id)}>
                              <TableCell>{String(l.actionType || l.action || '—')}</TableCell>
                              <TableCell>{String(l.userName || l.user_name || '—')}</TableCell>
                              <TableCell>{l.dateTime || l.timestamp ? new Date(String(l.dateTime || l.timestamp)).toLocaleString() : '—'}</TableCell>
                              <TableCell className="max-w-xs truncate">{String(l.actionDescription || l.reason || '')}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground">No audit entries for this effectiveness review.</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </div>
    </CapaEffectivenessAccessGuard>
  );
}
