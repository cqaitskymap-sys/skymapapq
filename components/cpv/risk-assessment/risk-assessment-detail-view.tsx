'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchRiskAssessmentById, fetchRiskAssessmentAuditTrail,
  reviewRiskAssessment, approveRiskAssessment, rejectRiskAssessment,
  recordEffectivenessReview, addRiskControl,
  linkRiskRecord, logRiskExport, updateRiskAssessment, closeRiskAssessment,
} from '@/lib/cpv-risk-assessment-service';
import {
  isOverdue, calculateRiskAssessment, riskAssessmentFormSchema,
  RISK_CATEGORIES, RISK_METHODOLOGIES, RISK_SOURCES,
  buildRiskAssessmentMatrix, buildRiskAssessmentHeatMap,
  type RiskAssessmentFormData, type RiskAssessmentRecord,
} from '@/lib/cpv-risk-assessment-records';
import { RiskMatrix } from './risk-matrix';
import { RiskHeatMap } from './risk-heatmap';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

type EsignAction = 'Approve' | 'Close' | 'QA Override';

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function promptChangeReason(action: string): string | null {
  const reason = window.prompt(`${action} — change reason (min 5 chars)`);
  if (!reason || reason.trim().length < 5) {
    toast.error('Change reason must be at least 5 characters');
    return null;
  }
  return reason.trim();
}

export function RiskAssessmentDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewRiskAssessment(profile?.role);
  const canEdit = cpvPermissions.canEditRiskAssessment(profile?.role);
  const canClose = cpvPermissions.canCloseRiskAssessment(profile?.role);
  const canExport = cpvPermissions.canImportExportRiskAssessment(profile?.role);

  const [record, setRecord] = useState<RiskAssessmentRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewComments, setReviewComments] = useState('');
  const [capaLink, setCapaLink] = useState('');
  const [controlDesc, setControlDesc] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<EsignAction>('Approve');
  const [actionReason, setActionReason] = useState('');

  const editForm = useForm<RiskAssessmentFormData>({
    resolver: zodResolver(riskAssessmentFormSchema),
    defaultValues: { changeReason: '' },
  });

  const severityScore = editForm.watch('severityScore');
  const occurrenceScore = editForm.watch('occurrenceScore');
  const detectionScore = editForm.watch('detectionScore');
  const scorePreview = useMemo(() => {
    if (!severityScore || !occurrenceScore || !detectionScore) {
      return { rpnScore: 0, riskLevel: 'Low' as const };
    }
    return calculateRiskAssessment(severityScore, occurrenceScore, detectionScore);
  }, [severityScore, occurrenceScore, detectionScore]);

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await fetchRiskAssessmentById(id);
    if (!r || r.isDeleted) {
      setError('Record not found.');
      setLoading(false);
      return;
    }
    setRecord(r);
    setCapaLink(r.linkedCapaNumber);
    const auditRows = await fetchRiskAssessmentAuditTrail(id);
    setAudit(auditRows);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => {
    if (!record) return null;
    return calculateRiskAssessment(record.severityScore, record.occurrenceScore, record.detectionScore, {
      severity: record.residualSeverity,
      occurrence: record.residualOccurrence,
      detection: record.residualDetection,
    });
  }, [record]);

  const openEdit = () => {
    if (!record) return;
    if (record.isLocked) {
      toast.error('Record is locked. Use QA Override to edit.');
      return;
    }
    editForm.reset({
      cpvProductId: record.cpvProductId || '',
      productName: record.productName,
      productCode: record.productCode,
      batchNumber: record.batchNumber || '',
      title: record.title || '',
      methodology: record.methodology || 'FMEA',
      riskCategory: record.riskCategory,
      riskSource: record.riskSource,
      processStage: record.processStage || '',
      parameterType: record.parameterType,
      parameterName: record.parameterName || '',
      riskDescription: record.riskDescription,
      potentialImpact: record.potentialImpact || '',
      potentialCause: record.potentialCause || '',
      existingControls: record.existingControls || '',
      severityScore: record.severityScore,
      occurrenceScore: record.occurrenceScore,
      detectionScore: record.detectionScore,
      riskOwner: record.riskOwner,
      mitigationAction: record.mitigationAction || '',
      targetCompletionDate: record.targetCompletionDate,
      effectivenessCheckRequired: record.effectivenessCheckRequired ?? true,
      linkedCapaNumber: record.linkedCapaNumber || '',
      linkedDeviationNumber: record.linkedDeviationNumber || '',
      linkedOosNumber: record.linkedOosNumber || '',
      linkedChangeControlNumber: record.linkedChangeControlNumber || '',
      remarks: record.remarks || '',
      changeReason: '',
    });
    setEditOpen(true);
  };

  const saveEdit = editForm.handleSubmit(async (values) => {
    if (!record) return;
    setSubmitting(true);
    const { result, error: err } = await updateRiskAssessment(record.id, values, actor, record);
    setSubmitting(false);
    if (err || !result) {
      toast.error(err || 'Update failed');
      return;
    }
    toast.success('Risk assessment updated');
    setEditOpen(false);
    await load();
  });

  const openEsignFlow = (action: EsignAction) => {
    setEsignAction(action);
    setActionReason('');
    setApproveOpen(true);
  };

  const continueToEsign = () => {
    if (actionReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setEsignOpen(true);
  };

  const handleEsignSuccess = async () => {
    if (!record) return;
    setEsignOpen(false);
    setSubmitting(true);
    try {
      if (esignAction === 'Approve') {
        const { error: err } = await approveRiskAssessment(
          record.id, actor, record, actionReason, { esignConfirmed: true },
        );
        if (err) toast.error(err);
        else {
          toast.success('Risk assessment approved');
          setApproveOpen(false);
          await load();
        }
      } else if (esignAction === 'Close') {
        const { error: err } = await closeRiskAssessment(
          record.id, actor, record, actionReason, { esignConfirmed: true },
        );
        if (err) toast.error(err);
        else {
          toast.success('Risk assessment closed');
          setApproveOpen(false);
          await load();
        }
      } else {
        const { error: err } = await updateRiskAssessment(
          record.id,
          { changeReason: actionReason },
          actor,
          record,
          true,
          { esignConfirmed: true, changeReason: actionReason },
        );
        if (err) toast.error(err);
        else {
          toast.success('QA override applied — record unlocked for edit');
          setApproveOpen(false);
          await load();
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const regenerateRisk = async () => {
    if (!record || record.isLocked) return;
    const reason = promptChangeReason('Recalculate risk');
    if (!reason) return;
    setSubmitting(true);
    const { error: err } = await updateRiskAssessment(record.id, {
      changeReason: reason,
      severityScore: record.severityScore,
      occurrenceScore: record.occurrenceScore,
      detectionScore: record.detectionScore,
    }, actor, record);
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success('Risk scores recalculated');
      await load();
    }
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record || !metrics) {
    return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;
  }

  const productKey = record.productCode || record.productName;
  const healthScore = Number(record.healthScore) || metrics.healthScore;
  const confidenceScore = Number(record.confidenceScore) || metrics.confidenceScore;
  const residualRpn = record.residualRpn || metrics.residualRpn;
  const riskReductionPercent = record.riskReductionPercent || metrics.riskReductionPercent;
  const aiRecommendation = record.aiRecommendation || metrics.aiRecommendation;

  const masterFields = [
    { label: 'Methodology', value: record.methodology },
    { label: 'Title', value: record.title },
    { label: 'Department', value: record.department },
    { label: 'Site', value: record.site },
    { label: 'Process', value: record.process },
    { label: 'Process Step', value: record.processStep },
    { label: 'Equipment', value: record.equipmentName || record.equipmentId },
    { label: 'Product Version', value: record.productVersion },
  ].filter((f) => f.value);

  const matrix = buildRiskAssessmentMatrix([record]);
  const heatMap = buildRiskAssessmentHeatMap([record]);

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title={record.riskNumber}
        description={`${record.productName} · ${record.riskCategory} · ${record.riskSource}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'CPV', href: '/cpv/dashboard' },
          { label: 'Risk Assessment Worksheet', href: '/cpv/risk-assessment' },
          { label: record.riskNumber },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/risk-assessment')}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            {canExport && (
              <>
                <Button size="sm" variant="outline" onClick={() => {
                  void logRiskExport(actor, 'register', 1);
                  toast.success('Export logged');
                }}>Export</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  void logRiskExport(actor, 'matrix', 1);
                  toast.success('PDF export logged');
                }}>Export PDF</Button>
              </>
            )}
            {canEdit && !record.isLocked && (
              <>
                <Button size="sm" variant="outline" onClick={openEdit}>Edit</Button>
                <Button size="sm" variant="outline" disabled={submitting} onClick={() => void regenerateRisk()}>
                  <RefreshCw className="h-4 w-4 mr-1" />Recalculate
                </Button>
              </>
            )}
            {canReview && record.isLocked && (
              <Button size="sm" variant="outline" onClick={() => openEsignFlow('QA Override')}>QA Override</Button>
            )}
            {canReview && record.workflowStatus === 'Draft' && (
              <Button size="sm" onClick={async () => {
                const reason = promptChangeReason('Submit for review');
                if (!reason) return;
                await updateRiskAssessment(record.id, { changeReason: reason }, actor, record);
                const { error: err } = await reviewRiskAssessment(record.id, actor, record, reviewComments);
                if (err) toast.error(err);
                else { toast.success('Submitted for review'); await load(); }
              }}>Submit Review</Button>
            )}
            {canReview && record.workflowStatus === 'Review' && (
              <>
                <Button size="sm" onClick={() => openEsignFlow('Approve')}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={async () => {
                  const reason = promptChangeReason('Reject risk');
                  if (!reason) return;
                  await updateRiskAssessment(record.id, { changeReason: reason }, actor, record);
                  const { error: err } = await rejectRiskAssessment(record.id, actor, record);
                  if (err) toast.error(err);
                  else { toast.success('Risk rejected'); await load(); }
                }}>Reject</Button>
              </>
            )}
            {canClose && !['Closed', 'Accepted', 'Rejected'].includes(record.riskStatus) && (
              <Button size="sm" variant="outline" onClick={() => openEsignFlow('Close')}>Close Risk</Button>
            )}
            {canClose && !['Closed', 'Accepted', 'Rejected'].includes(record.riskStatus) && (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/qms/risk-management/${record.id}/fmea`}>FMEA</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/qms/risk-management/${record.id}/mitigation-plan`}>Mitigation Plan</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/qms/risk-management/${record.id}/closure`}>Risk Closure</Link>
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: `/cpv/cpp?product=${encodeURIComponent(productKey)}`, label: 'CPP' },
          { href: `/cpv/cqa?product=${encodeURIComponent(productKey)}`, label: 'CQA' },
          { href: '/cpv/yield-monitoring', label: 'Yield' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: '/cpv/utility-monitoring', label: 'Utility' },
          { href: '/cpv/process-capability', label: 'Process Capability' },
          { href: `/cpv/trend-analysis?product=${encodeURIComponent(productKey)}`, label: 'Trend Analysis' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/batch-registration', label: 'Batch' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/qms/change-control', label: 'Change Control' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/ai-analytics', label: 'AI Analytics' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="RPN" value={record.rpnScore} tone={record.riskLevel === 'Critical' ? 'red' : record.riskLevel === 'High' ? 'amber' : 'green'} />
        <KpiCard label="Residual RPN" value={residualRpn || '—'} tone={residualRpn >= 101 ? 'red' : residualRpn >= 51 ? 'amber' : 'green'} />
        <KpiCard label="Risk Reduction" value={riskReductionPercent ? `${riskReductionPercent}%` : '—'} tone="blue" />
        <KpiCard label="Health Score" value={healthScore} tone="blue" />
        <KpiCard label="Confidence" value={confidenceScore} />
        <KpiCard label="Severity" value={record.severityScore} />
        <KpiCard label="Occurrence" value={record.occurrenceScore} />
        <KpiCard label="Detection" value={record.detectionScore} />
      </div>

      {isOverdue(record) && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Target completion date {record.targetCompletionDate} has passed.
        </div>
      )}

      {record.capaSuggested && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          CAPA suggested based on risk level and scoring.
        </div>
      )}

      <Tabs defaultValue="assessment" className="space-y-4">
        <TabsList>
          <TabsTrigger value="assessment">Assessment</TabsTrigger>
          <TabsTrigger value="controls">Controls</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="assessment">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Risk Details</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Level</span><RiskBadge level={record.riskLevel} /></div>
                {record.residualRiskLevel && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Residual Level</span><RiskBadge level={record.residualRiskLevel} /></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{record.riskStatus}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Workflow</span><span>{record.workflowStatus}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Owner</span><span>{record.riskOwner}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Target Date</span><span>{record.targetCompletionDate || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Batch</span><span>{record.batchNumber || 'All batches'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Parameter</span><span>{record.parameterName || '—'}</span></div>
                <p className="pt-2 text-muted-foreground">{record.riskDescription}</p>
                {record.potentialImpact && <p><span className="text-muted-foreground">Impact: </span>{record.potentialImpact}</p>}
                {record.mitigationAction && <p><span className="text-muted-foreground">Mitigation: </span>{record.mitigationAction}</p>}
                {record.isAutoGenerated && <p className="text-amber-700">Auto-generated risk</p>}
                {record.isLocked && <p className="text-slate-600">Record locked after approval</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Assessment & AI</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Methodology</span><span>{record.methodology || 'FMEA'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Health</span><span>{healthScore}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Confidence</span><span>{confidenceScore}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Risk Reduction</span><span>{riskReductionPercent ? `${riskReductionPercent}%` : '—'}</span></div>
                {record.deviationRequired && <p className="text-red-700">Deviation required</p>}
                <p className="text-muted-foreground mt-2">{aiRecommendation}</p>
                {record.approvedBy && (
                  <div className="flex justify-between pt-2"><span className="text-muted-foreground">Approved</span><span>{record.approvedBy} · {record.approvalDate}</span></div>
                )}
              </CardContent>
            </Card>
            {masterFields.length > 0 && (
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-base">Master Data</CardTitle></CardHeader>
                <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {masterFields.map((f) => (
                    <div key={f.label} className="flex justify-between gap-2 border-b pb-1">
                      <span className="text-muted-foreground">{f.label}</span>
                      <span className="text-right">{f.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Linked Records</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label>CAPA Number</Label>
                  <div className="mt-1 flex gap-2">
                    <Input value={capaLink} onChange={(e) => setCapaLink(e.target.value)} disabled={!canEdit || record.isLocked} />
                    {canEdit && !record.isLocked && (
                      <Button size="sm" onClick={async () => {
                        const reason = promptChangeReason('Link CAPA');
                        if (!reason) return;
                        await updateRiskAssessment(record.id, { changeReason: reason }, actor, record);
                        await linkRiskRecord(record.id, 'linkedCapaNumber', capaLink, actor, record);
                        toast.success('CAPA linked');
                        await load();
                      }}>Link</Button>
                    )}
                  </div>
                </div>
                <div className="grid gap-1 text-sm">
                  <p>Deviation: {record.linkedDeviationNumber || '—'}</p>
                  <p>OOS: {record.linkedOosNumber || '—'}</p>
                  <p>Change Control: {record.linkedChangeControlNumber || '—'}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="controls">
          <Card>
            <CardHeader><CardTitle className="text-base">Risk Controls</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {canEdit && !record.isLocked && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input placeholder="Control description" value={controlDesc} onChange={(e) => setControlDesc(e.target.value)} />
                  <Button onClick={async () => {
                    if (!controlDesc.trim()) return;
                    const reason = promptChangeReason('Add control');
                    if (!reason) return;
                    await updateRiskAssessment(record.id, { changeReason: reason }, actor, record);
                    await addRiskControl(record.id, {
                      controlDescription: controlDesc,
                      controlType: 'Corrective',
                      owner: record.riskOwner,
                      targetDate: record.targetCompletionDate,
                      status: 'Open',
                      effectiveness: 'Pending',
                    }, actor, record);
                    setControlDesc('');
                    toast.success('Control added');
                    await load();
                  }}>Add Control</Button>
                </div>
              )}
              {record.controls?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {record.controls.map((c) => (
                      <TableRow key={c.controlId}>
                        <TableCell>{c.controlId}</TableCell>
                        <TableCell>{c.controlDescription}</TableCell>
                        <TableCell>{c.owner}</TableCell>
                        <TableCell>{c.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No controls recorded.</p>
              )}
              {canReview && record.effectivenessCheckRequired && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {(['Effective', 'Partially Effective', 'Not Effective'] as const).map((s) => (
                    <Button key={s} size="sm" variant="outline" onClick={async () => {
                      const reason = promptChangeReason(`Effectiveness: ${s}`);
                      if (!reason) return;
                      await updateRiskAssessment(record.id, { changeReason: reason }, actor, record);
                      await recordEffectivenessReview(record.id, s, actor, record);
                      toast.success(`Effectiveness: ${s}`);
                      await load();
                    }}>{s}</Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader><CardTitle className="text-base">Risk Review</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea placeholder="Review comments" value={reviewComments} onChange={(e) => setReviewComments(e.target.value)} />
              {record.reviews?.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Reviewer</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Comments</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {record.reviews.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{r.reviewDate}</TableCell>
                        <TableCell>{r.reviewer}</TableCell>
                        <TableCell>{r.decision}</TableCell>
                        <TableCell>{r.comments}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No review history yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matrix">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Risk Matrix</CardTitle></CardHeader><CardContent><RiskMatrix matrix={matrix} /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Heat Map</CardTitle></CardHeader><CardContent><RiskHeatMap heatMap={heatMap} /></CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {audit.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((row) => (
                      <TableRow key={String(row.id)}>
                        <TableCell>{String(row.action || row.actionType || '')}</TableCell>
                        <TableCell>{String(row.userName || row.userId || '')}</TableCell>
                        <TableCell>{String(row.reason || '—')}</TableCell>
                        <TableCell>{String(row.createdAt || row.timestamp || '')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No audit entries yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={approveOpen && !esignOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {esignAction === 'Close' ? 'Close Risk Assessment' : esignAction === 'QA Override' ? 'QA Override' : 'Approve Risk Assessment'}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">Electronic signature required (21 CFR Part 11).</p>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Minimum 5 characters" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={continueToEsign} disabled={submitting}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="CPV Risk Assessment Worksheet"
        recordId={record.id}
        documentNumber={record.riskNumber}
        actionType={esignAction}
        onSuccess={() => void handleEsignSuccess()}
        onCancel={() => setEsignOpen(false)}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Risk Assessment</DialogTitle></DialogHeader>
          <Form {...editForm}>
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField control={editForm.control} name="riskCategory" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Risk Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {RISK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="methodology" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Methodology</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {RISK_METHODOLOGIES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="riskSource" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Risk Source</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {RISK_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="riskOwner" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Risk Owner</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="targetCompletionDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target Completion Date</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="riskDescription" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Risk Description</FormLabel>
                    <FormControl><Textarea {...field} rows={3} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="severityScore" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Severity (1–10)</FormLabel>
                    <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="occurrenceScore" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Occurrence (1–10)</FormLabel>
                    <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="detectionScore" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Detection (1–10)</FormLabel>
                    <Select value={String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="rounded-lg border bg-slate-50 p-4">
                  <p className="text-xs text-muted-foreground">Recalculated RPN</p>
                  <p className="mt-1 text-2xl font-bold">RPN {scorePreview.rpnScore}</p>
                  <RiskBadge level={scorePreview.riskLevel} />
                </div>
                <FormField control={editForm.control} name="mitigationAction" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Mitigation Action</FormLabel>
                    <FormControl><Textarea {...field} rows={2} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="changeReason" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Change Reason * (ALCOA+)</FormLabel>
                    <FormControl><Textarea {...field} rows={2} placeholder="Minimum 5 characters" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save Changes'}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
