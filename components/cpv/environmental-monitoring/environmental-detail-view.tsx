'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchEnvironmentalRecordById, fetchEnvironmentalAuditTrail,
  approveEnvironmentalRecord, reviewEnvironmentalRecord,
  environmentalParameterTrendData, fetchEnvironmentalRecords, softDeleteEnvironmentalRecord,
} from '@/lib/cpv-environmental-monitoring-service';
import type { EnvironmentalMonitoringRecord } from '@/lib/cpv-environmental-monitoring';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function GradeBadge({ grade }: { grade: string }) {
  const critical = ['Grade A', 'Grade B'].includes(grade);
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${critical ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>{grade}</span>;
}

export function EnvironmentalDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewEnvironmental(profile?.role);
  const [record, setRecord] = useState<EnvironmentalMonitoringRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [trend, setTrend] = useState<ReturnType<typeof environmentalParameterTrendData>>([]);
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
    const r = await fetchEnvironmentalRecordById(id);
    if (!r) { setError('Environmental record not found.'); setLoading(false); return; }
    setRecord(r);
    const [auditRows, all] = await Promise.all([fetchEnvironmentalAuditTrail(id), fetchEnvironmentalRecords()]);
    setAudit(auditRows);
    setTrend(environmentalParameterTrendData(all, r.parameterName));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const applyReview = async () => {
    if (!record || reviewReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
    setSubmitting(true);
    const { error: err } = await reviewEnvironmentalRecord(record.id, actor, reviewReason);
    setSubmitting(false); setReviewOpen(false);
    if (err) toast.error(err); else { toast.success('Submitted for review'); await load(); }
  };
  const applyApprove = async () => {
    if (!record) return;
    setSubmitting(true);
    const { error: err } = await approveEnvironmentalRecord(record.id, actor, approveReason, { esignConfirmed: true });
    setSubmitting(false); setEsignOpen(false); setApproveOpen(false); setApproveReason('');
    if (err) toast.error(err); else { toast.success('Environmental record approved'); await load(); }
  };
  const applyDelete = async () => {
    if (!record) return;
    setSubmitting(true);
    const { error: err } = await softDeleteEnvironmentalRecord(record.id, actor, deleteReason, { esignConfirmed: true });
    setSubmitting(false); setEsignOpen(false); setDeleteOpen(false); setDeleteReason('');
    if (err) toast.error(err); else { toast.success('Record soft-deleted'); router.push('/cpv/environmental-monitoring'); }
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title={record.parameterName}
        description={`${record.batchNumber} · ${record.areaName}`}
        trail={[
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Environmental Monitoring', href: '/cpv/environmental-monitoring' },
          { label: record.environmentalMonitoringId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/environmental-monitoring')}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
            {canReview && record.reviewStatus === 'Draft' && (
              <Button size="sm" onClick={() => { setReviewReason('Submitted for QA review'); setReviewOpen(true); }}>Submit Review</Button>
            )}
            {canReview && (record.reviewStatus === 'Under Review' || record.reviewStatus === 'Draft') && (
              <Button size="sm" onClick={() => { setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
            )}
            {canReview && record.reviewStatus !== 'Approved' && !record.isDeleted && (
              <Button size="sm" variant="destructive" onClick={() => { setDeleteReason(''); setDeleteOpen(true); }}><Trash2 className="mr-1 h-4 w-4" />Soft Delete</Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <GradeBadge grade={record.cleanroomGrade} />
        <StatusBadge status={record.monitoringType} />
        <StatusBadge status={record.status} />
        <RiskBadge level={record.riskLevel} />
        <StatusBadge status={record.reviewStatus} />
      </div>
      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: record.cpvProductId ? `/cpv/product-master/${record.cpvProductId}` : `/cpv/product-master?search=${encodeURIComponent(record.productCode)}`, label: 'Product Master' },
          { href: `/cpv/batch-registration?search=${encodeURIComponent(record.batchNumber)}`, label: 'Batch' },
          { href: `/cpv/cpp?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CPP' },
          { href: `/cpv/cqa?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CQA' },
          { href: '/cpv/utility-monitoring', label: 'Utility' },
          { href: record.equipmentId ? `/qms/equipment?search=${encodeURIComponent(record.equipmentId)}` : '/qms/equipment', label: 'Equipment' },
          { href: '/qms/equipment/calibration-schedule', label: 'Calibration' }, { href: '/qms/equipment/preventive-maintenance', label: 'Maintenance' },
          { href: '/qms/deviation', label: 'Deviation' }, { href: '/qms/capa', label: 'CAPA' }, { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/admin/audit-trail', label: 'Audit Trail' }, { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/statistical-process-control', label: 'SPC' }, { href: '/cpv/trend-analysis', label: 'Trends' },
        ].map((link) => <Link key={link.href + link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">{link.label}</Link>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Observed" value={String(record.observedValue)} tone="blue" />
        <KpiCard label="Target" value={String(record.targetValue ?? '—')} tone="green" />
        <KpiCard label="Limits" value={`${record.lowerLimit} – ${record.upperLimit} ${record.unit}`} tone="amber" />
        <KpiCard label="Deviation" value={record.linkedDeviationNumber || '—'} tone="red" />
      </div>
      <Card>
        <CardHeader><CardTitle>Environmental Details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[
            ['Environmental ID', record.environmentalMonitoringId],
            ['Room', record.roomNumber],
            ['Process Stage', record.processStage],
            ['Sampling Location', record.samplingLocation],
            ['Building / Block / Floor', [record.building, record.block, record.floor].filter(Boolean).join(' / ')],
            ['Site / Zone', [record.site, record.zone].filter(Boolean).join(' / ')],
            ['Department / Shift', [record.department, record.shift].filter(Boolean).join(' / ')],
            ['AHU', record.ahuName || record.ahuId],
            ['ISO Class', record.isoClass],
            ['Monitoring Point', record.monitoringPointName || record.monitoringPointCode],
            ['Equipment', record.equipmentName || record.equipmentId],
            ['Data Source', record.dataSource || 'Manual'],
            ['Sensor ID', record.sensorId],
            ['Alarm Status', record.alarmStatus],
            ['Communication', record.communicationStatus],
            ['Specification', [record.specificationNumber, record.version].filter(Boolean).join(' · ')],
            ['Effective Date', record.effectiveDate],
            ['Alert Limits', `${record.alertLimitLow ?? '—'} / ${record.alertLimitHigh ?? '—'}`],
            ['Action Limits', `${record.actionLimitLow ?? '—'} / ${record.actionLimitHigh ?? '—'}`],
            ['OOS / OOT Status', ['OOS', 'OOT'].includes(record.status) ? record.status : '—'],
            ['Monitoring', `${record.monitoringDate} ${record.monitoringTime}`],
            ['Recorded By', record.recordedBy],
            ['Reviewed By', record.reviewedBy],
            ['CAPA Required', record.capaRequired ? 'Yes' : 'No'],
            ['Remarks', record.remarks],
          ].map(([l, v]) => (
            <div key={String(l)}><p className="text-xs text-muted-foreground">{String(l)}</p><p>{String(v || '—')}</p></div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Parameter Trend</CardTitle></CardHeader>
        <CardContent>{trend.length ? <ParameterTrendChart data={trend} /> : <EmptyState title="No trend data" />}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Audit Trail</CardTitle></CardHeader>
        <CardContent>
          {audit.length === 0 ? <EmptyState title="No audit events" /> : (
            <div className="overflow-x-auto rounded-lg border"><Table>
              <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>User</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
              <TableBody>
                {audit.map((a, i) => (
                  <TableRow key={String(a.id || i)}>
                    <TableCell className="text-xs">{String(a.timestamp || a.dateTime || '—')}</TableCell>
                    <TableCell>{String(a.actionType || a.action || '—')}</TableCell>
                    <TableCell>{String(a.changedByUserName || a.userName || '—')}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs">{String(a.actionDescription || a.reason || a.changeReason || '—')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit for Review</DialogTitle><DialogDescription>Provide a change reason for the review submission.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button><Button disabled={submitting} onClick={() => void applyReview()}>Submit</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen && !esignOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Approve Environmental Record</DialogTitle><DialogDescription>Change reason and electronic signature required (Part 11 / ALCOA+).</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={approveReason} onChange={(e) => setApproveReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button><Button disabled={submitting} onClick={() => {
            if (approveReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
            setEsignAction('approve'); setEsignOpen(true);
          }}>Continue to E-Sign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen && !esignOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Soft-Delete Environmental Record</DialogTitle><DialogDescription>Archive this record with change reason and electronic signature.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label>Change Reason *</Label><Textarea value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" disabled={submitting} onClick={() => {
            if (deleteReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
            setEsignAction('delete'); setEsignOpen(true);
          }}>Continue to E-Sign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Environmental Monitoring"
        recordId={record.id}
        documentNumber={record.environmentalMonitoringId}
        actionType={esignAction === 'approve' ? 'Approve' : 'Soft Delete'}
        onSuccess={() => { if (esignAction === 'approve') void applyApprove(); else void applyDelete(); }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
