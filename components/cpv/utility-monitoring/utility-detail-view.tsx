'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchUtilityRecordById, fetchUtilityAuditTrail, approveUtilityRecord, reviewUtilityRecord,
  utilityParameterTrendData, fetchUtilityRecords, softDeleteUtilityRecord,
  type UtilityActor,
} from '@/lib/cpv-utility-monitoring-service';
import type { UtilityMonitoringRecord } from '@/lib/cpv-utility-monitoring';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ParameterTrendChart } from '@/components/cpv/cpp-monitoring/parameter-trend-chart';
import { KpiCard, StatusBadge } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function UtilityTypeBadge({ type }: { type: string }) {
  return <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">{type}</span>;
}

function ComplianceBadges({ record }: { record: UtilityMonitoringRecord }) {
  const raw = record as Record<string, unknown>;
  const oos = record.status === 'OOS' || record.status === 'Excursion' || Boolean(raw.oosRequired || raw.linkedOosNumber);
  return (
    <>
      <StatusBadge status={record.status} />
      {oos && !['OOS', 'Excursion'].includes(record.status) && <StatusBadge status="OOS" />}
      {['Alert', 'Action', 'OOT'].includes(record.status) && <StatusBadge status={record.status === 'Action' ? 'OOT' : record.status} />}
      {record.status === 'Excursion' && <StatusBadge status="Excursion" />}
    </>
  );
}

async function callReview(id: string, actor: UtilityActor, changeReason: string) {
  return reviewUtilityRecord(id, actor, changeReason);
}

async function callApprove(
  id: string,
  actor: UtilityActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return approveUtilityRecord(id, actor, changeReason, options);
}

async function callSoftDelete(
  id: string,
  actor: UtilityActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return softDeleteUtilityRecord(id, actor, changeReason, options);
}

export function UtilityDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewUtility(profile?.role);
  const [record, setRecord] = useState<UtilityMonitoringRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [trend, setTrend] = useState<ReturnType<typeof utilityParameterTrendData>>([]);
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
    const r = await fetchUtilityRecordById(id);
    if (!r) { setError('Utility record not found.'); setLoading(false); return; }
    setRecord(r);
    const [auditRows, all] = await Promise.all([fetchUtilityAuditTrail(id), fetchUtilityRecords()]);
    setAudit(auditRows);
    setTrend(utilityParameterTrendData(all, r.parameterName));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const applyReview = async () => {
    if (!record) return;
    if (reviewReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setSubmitting(true);
    const { error: err } = await callReview(record.id, actor, reviewReason);
    setSubmitting(false);
    setReviewOpen(false);
    if (err) toast.error(err);
    else {
      toast.success('Submitted for review');
      await load();
    }
  };

  const applyApprove = async () => {
    if (!record) return;
    setSubmitting(true);
    const { error: err } = await callApprove(record.id, actor, approveReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setApproveOpen(false);
    setApproveReason('');
    if (err) toast.error(err);
    else {
      toast.success('Utility record approved');
      await load();
    }
  };

  const applyDelete = async () => {
    if (!record) return;
    setSubmitting(true);
    const { error: err } = await callSoftDelete(record.id, actor, deleteReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setDeleteOpen(false);
    setDeleteReason('');
    if (err) toast.error(err);
    else {
      toast.success('Record soft-deleted');
      router.push('/cpv/utility-monitoring');
    }
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  const deviationHref = record.linkedDeviationNumber
    ? `/qms/deviation?search=${encodeURIComponent(record.linkedDeviationNumber)}`
    : '/qms/deviation';
  const capaHref = record.linkedCapaNumber
    ? `/qms/capa?search=${encodeURIComponent(record.linkedCapaNumber)}`
    : '/qms/capa';

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title={record.parameterName}
        description={`${record.batchNumber} · ${record.utilitySystemName}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Utility Monitoring', href: '/cpv/utility-monitoring' },
          { label: record.utilityMonitoringId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/utility-monitoring')}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
            {canReview && record.reviewStatus === 'Draft' && (
              <Button size="sm" onClick={() => { setReviewReason('Submitted for QA review'); setReviewOpen(true); }}>Submit Review</Button>
            )}
            {canReview && (record.reviewStatus === 'Under Review' || record.reviewStatus === 'Draft') && (
              <Button size="sm" onClick={() => { setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
            )}
            {canReview && record.reviewStatus !== 'Approved' && !record.isDeleted && (
              <Button size="sm" variant="destructive" onClick={() => { setDeleteReason(''); setDeleteOpen(true); }}>
                <Trash2 className="h-4 w-4 mr-1" />Soft Delete
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <UtilityTypeBadge type={record.utilityType} />
        <ComplianceBadges record={record} />
        <RiskBadge level={record.riskLevel} />
        <StatusBadge status={record.reviewStatus} />
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">{record.samplingPoint}</span>
      </div>

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          ...(record.cpvProductId
            ? [{ href: `/cpv/product-master/${record.cpvProductId}`, label: 'Product Master' }]
            : [{ href: `/cpv/product-master?search=${encodeURIComponent(record.productCode)}`, label: 'Product Master' }]),
          { href: `/cpv/batch-registration?search=${encodeURIComponent(record.batchNumber)}`, label: 'Batch' },
          { href: `/cpv/cpp?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CPP' },
          { href: `/cpv/cqa?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CQA' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: record.equipmentId ? `/qms/equipment?search=${encodeURIComponent(record.equipmentId)}` : '/qms/equipment', label: 'Equipment' },
          { href: '/qms/equipment/calibration-schedule', label: 'Calibration' },
          { href: '/qms/equipment/preventive-maintenance', label: 'Maintenance' },
          { href: deviationHref, label: 'Deviation' },
          { href: capaHref, label: 'CAPA' },
          { href: '/cpv/risk-assessment', label: 'Risk Management' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/trend-analysis', label: 'Trends' },
        ].map((l) => (
          <Link
            key={l.href + l.label}
            href={l.href}
            className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
          >
            {l.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Observed" value={String(record.observedValue)} tone="blue" />
        <KpiCard label="Target" value={String(record.targetValue ?? '—')} tone="green" />
        <KpiCard label="LSL / USL" value={`${record.lowerLimit} – ${record.upperLimit} ${record.unit}`} tone="amber" />
        <KpiCard label="Deviation" value={record.linkedDeviationNumber || '—'} tone="red" />
      </div>

      <Card>
        <CardHeader><CardTitle>Utility Details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[
            ['Utility Monitoring ID', record.utilityMonitoringId],
            ['Utility System', record.utilitySystemName],
            ['Sampling Point', record.samplingPoint],
            ['Building', record.building],
            ['Area / Room', record.areaRoomNo],
            ['Department', record.department],
            ['Shift', record.shift],
            ['Monitoring Date', `${record.monitoringDate} ${record.monitoringTime}`],
            ['Recorded By', record.recordedBy],
            ['Reviewed By', record.reviewedBy],
            ['Alert Limits', `${record.alertLimitLow ?? '—'} / ${record.alertLimitHigh ?? '—'}`],
            ['Action Limits', `${record.actionLimitLow ?? '—'} / ${record.actionLimitHigh ?? '—'}`],
            ['Equipment', record.equipmentName || record.equipmentId],
            ['Data Source', record.dataSource || 'Manual'],
            ['Sensor ID', record.sensorId],
            ['Alarm Status', record.alarmStatus],
            ['Communication', record.communicationStatus],
            ['Deviation', record.linkedDeviationNumber],
            ['CAPA', record.linkedCapaNumber],
            ['CAPA Required', record.capaRequired ? 'Yes' : 'No'],
            ['OOS Ref', record.linkedOosNumber || (record.oosRequired ? 'Required' : '—')],
            ['Remarks', record.remarks],
          ].map(([l, v]) => (
            <div key={String(l)}><p className="text-xs text-muted-foreground">{l}</p><p>{v || '—'}</p></div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Parameter Trend</CardTitle></CardHeader>
        <CardContent>
          {trend.length ? <ParameterTrendChart data={trend} /> : <EmptyState title="No trend data" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Audit Trail</CardTitle></CardHeader>
        <CardContent>
          {audit.length === 0 ? <EmptyState title="No audit events" /> : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Timestamp', 'Action', 'User', 'Details'].map((h) => <TableHead key={h}>{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((a, i) => (
                    <TableRow key={String(a.id || i)}>
                      <TableCell className="text-xs">{String(a.timestamp || a.dateTime || a.createdAt || '—')}</TableCell>
                      <TableCell>{String(a.actionType || a.action || '—')}</TableCell>
                      <TableCell>{String(a.userName || a.user_name || a.changedByUserName || a.performedBy || '—')}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs">{String(a.actionDescription || a.reason || a.changeReason || '—')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit for Review</DialogTitle>
            <DialogDescription>Provide a change reason for the review submission.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => { void applyReview(); }}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen && !esignOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Utility Record</DialogTitle>
            <DialogDescription>Change reason and electronic signature required (Part 11 / ALCOA+).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={approveReason} onChange={(e) => setApproveReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => {
              if (approveReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignAction('approve');
              setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen && !esignOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft-Delete Utility Record</DialogTitle>
            <DialogDescription>Archive this record with change reason and electronic signature.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={submitting} onClick={() => {
              if (deleteReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignAction('delete');
              setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Utility Monitoring"
        recordId={record.id}
        documentNumber={record.utilityMonitoringId}
        actionType={esignAction === 'approve' ? 'Approve' : 'Soft Delete'}
        onSuccess={() => {
          if (esignAction === 'approve') void applyApprove();
          else void applyDelete();
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
