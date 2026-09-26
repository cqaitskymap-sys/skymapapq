'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchStabilityResultById, fetchStabilityAuditTrail, fetchStabilityResults,
  approveStabilityResult, reviewStabilityResult, stabilityParameterTrendData,
  updateStabilityAttachments, softDeleteStabilityResult,
} from '@/lib/cpv-stability-monitoring-service';
import type { StabilityResultRecord } from '@/lib/cpv-stability-monitoring';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ParameterTrendChart } from '@/components/cpv/cpp-monitoring/parameter-trend-chart';
import { StabilityAttachmentUploader } from './stability-attachment-uploader';
import { KpiCard, StatusBadge } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

export function StabilityDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewStability(profile?.role);
  const canEdit = cpvPermissions.canEnterStabilityResults(profile?.role);
  const [record, setRecord] = useState<StabilityResultRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [trend, setTrend] = useState<ReturnType<typeof stabilityParameterTrendData>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState('Submitted for QA review');
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveReason, setApproveReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [esignAction, setEsignAction] = useState<'approve' | 'delete'>('approve');
  const [submitting, setSubmitting] = useState(false);
  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchStabilityResultById(id);
    if (!r) { setError('Stability result not found.'); setLoading(false); return; }
    setRecord(r);
    const [auditRows, all] = await Promise.all([fetchStabilityAuditTrail(id), fetchStabilityResults()]);
    setAudit(auditRows);
    setTrend(stabilityParameterTrendData(
      all.filter((x) => x.batchNumber === r.batchNumber && x.parameterName === r.parameterName),
      r.parameterName,
    ));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const saveAttachments = async (attachments: StabilityResultRecord['attachments']) => {
    if (!record) return;
    const { result, error: err } = await updateStabilityAttachments(record.id, attachments, actor, record, 'Attachment updated');
    if (err) toast.error(err);
    else if (result) setRecord(result);
  };

  const applyReview = async () => {
    if (!record) return;
    if (reviewReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setSubmitting(true);
    const { error: err } = await reviewStabilityResult(record.id, actor, reviewReason);
    setSubmitting(false);
    setReviewOpen(false);
    if (err) toast.error(err);
    else { toast.success('Submitted for review'); await load(); }
  };

  const applyApprove = async () => {
    if (!record) return;
    setSubmitting(true);
    const { error: err } = await approveStabilityResult(record.id, actor, approveReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setApproveOpen(false);
    setApproveReason('');
    if (err) toast.error(err);
    else { toast.success('Stability result approved'); await load(); }
  };

  const applyDelete = async () => {
    if (!record) return;
    setSubmitting(true);
    const { error: err } = await softDeleteStabilityResult(record.id, actor, deleteReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setDeleteOpen(false);
    setDeleteReason('');
    if (err) toast.error(err);
    else {
      toast.success('Stability result soft-deleted');
      router.push('/cpv/stability-monitoring');
    }
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title={record.parameterName}
        description={`${record.batchNumber} · ${record.pullingInterval} · ${record.stabilityStudyNumber}`}
        trail={[
          { label: 'CPV Dashboard', href: '/cpv/dashboard' },
          { label: 'Stability Monitoring', href: '/cpv/stability-monitoring' },
          { label: record.stabilityMonitoringId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/stability-monitoring')}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            {canReview && record.reviewStatus === 'Draft' && (
              <Button size="sm" onClick={() => { setReviewReason('Submitted for QA review'); setReviewOpen(true); }}>Submit Review</Button>
            )}
            {canReview && (record.reviewStatus === 'Under Review' || record.reviewStatus === 'Draft') && (
              <Button size="sm" onClick={() => { setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
            )}
            {canReview && record.reviewStatus !== 'Approved' && !record.isDeleted && (
              <Button size="sm" variant="destructive" onClick={() => { setDeleteReason(''); setDeleteOpen(true); }}>
                <Trash2 className="mr-1 h-4 w-4" />Soft Delete
              </Button>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: record.cpvProductId ? `/cpv/product-master/${record.cpvProductId}` : `/cpv/product-master?search=${encodeURIComponent(record.productCode)}`, label: 'Product' },
          { href: `/cpv/batch-registration?search=${encodeURIComponent(record.batchNumber)}`, label: 'Batch' },
          { href: `/cpv/cpp?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CPP' },
          { href: `/cpv/cqa?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CQA' },
          { href: `/cpv/yield-monitoring?batch=${encodeURIComponent(record.batchNumber)}`, label: 'Yield' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: `/cpv/utility-monitoring?batch=${encodeURIComponent(record.batchNumber)}`, label: 'Utility' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/trend-analysis', label: 'Trends' },
        ].map((link) => (
          <Link key={link.href + link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Observed Result" value={String(record.observedResult)} />
        <KpiCard label="Status" value={record.status} tone={record.status === 'Complies' ? 'green' : 'red'} />
        <KpiCard label="Risk Level" value={record.riskLevel} tone="amber" />
        <KpiCard label="Review Status" value={record.reviewStatus} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Study & Batch</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Product</span><span>{record.productName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Batch</span><span>{record.batchNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Study Type</span><span>{record.studyType}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Storage Condition</span><span>{record.storageCondition}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Interval</span><span>{record.pullingInterval}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Test Date</span><span>{record.testDate}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Analyst</span><span>{record.analyst}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Specification</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span>{record.targetValue} {record.unit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Lower Limit</span><span>{record.lowerLimit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Upper Limit</span><span>{record.upperLimit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={record.status} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Risk</span><RiskBadge level={record.riskLevel} /></div>
            {record.linkedOosNumber && (
              <div className="flex justify-between"><span className="text-muted-foreground">Linked OOS</span><span>{record.linkedOosNumber}</span></div>
            )}
            {record.capaRequired && (
              <div className="flex justify-between"><span className="text-muted-foreground">CAPA</span><span className="text-amber-700">Suggested</span></div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{record.parameterName} Trend</CardTitle></CardHeader>
        <CardContent>
          <ParameterTrendChart data={trend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Attachments</CardTitle></CardHeader>
        <CardContent>
          <StabilityAttachmentUploader
            recordId={record.id}
            uploadedBy={actor.name}
            attachments={record.attachments || []}
            onChange={(files) => void saveAttachments(files)}
            disabled={(record.isLocked && !canReview) || !canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
        <CardContent>
          {audit.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell>{String(row.action || row.actionType || '')}</TableCell>
                    <TableCell>{String(row.userName || row.userId || '')}</TableCell>
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

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit for Review</DialogTitle><DialogDescription>Provide a change reason for this review submission.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button><Button disabled={submitting} onClick={() => void applyReview()}>Submit</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen && !esignOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve Stability Result</DialogTitle><DialogDescription>Change reason and electronic signature are required (Part 11 / ALCOA+).</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={approveReason} onChange={(e) => setApproveReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => {
              if (approveReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignAction('approve'); setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen && !esignOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Soft-Delete Stability Result</DialogTitle><DialogDescription>Archive this record with a change reason and electronic signature.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={submitting} onClick={() => {
              if (deleteReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignAction('delete'); setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Stability Monitoring"
        recordId={record.id}
        documentNumber={record.stabilityMonitoringId}
        actionType={esignAction === 'approve' ? 'Approve' : 'Soft Delete'}
        onSuccess={() => { if (esignAction === 'approve') void applyApprove(); else void applyDelete(); }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
