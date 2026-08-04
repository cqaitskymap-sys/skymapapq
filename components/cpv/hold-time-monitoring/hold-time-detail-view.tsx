'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchHoldTimeRecordById, fetchHoldTimeAuditTrail, fetchHoldTimeRecords,
  approveHoldTimeRecord, reviewHoldTimeRecord, holdTimeStageTrendData,
  refreshLiveHoldMetrics,
} from '@/lib/cpv-hold-time-monitoring-service';
import {
  computeHoldTimeStats, formatCountdown, detectWesternElectricViolations,
  computeEwma, computeCusum,
  type HoldTimeMonitoringRecord,
} from '@/lib/cpv-hold-time-monitoring';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ParameterTrendChart } from '@/components/cpv/cpp-monitoring/parameter-trend-chart';
import { KpiCard, StatusBadge } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

export function HoldTimeDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewHoldTime(profile?.role);
  const [record, setRecord] = useState<HoldTimeMonitoringRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [trend, setTrend] = useState<ReturnType<typeof holdTimeStageTrendData>>([]);
  const [stageValues, setStageValues] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [approveReason, setApproveReason] = useState('');
  const [tick, setTick] = useState(0);
  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchHoldTimeRecordById(id);
    if (!r) { setError('Hold time record not found.'); setLoading(false); return; }
    setRecord(r);
    const [auditRows, all] = await Promise.all([fetchHoldTimeAuditTrail(id), fetchHoldTimeRecords()]);
    setAudit(auditRows);
    setTrend(holdTimeStageTrendData(all, r.holdStage));
    setStageValues(all.filter((x) => x.holdStage === r.holdStage).map((x) => x.actualHoldTime));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const live = useMemo(
    () => (record ? refreshLiveHoldMetrics(record) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick forces live countdown recompute
    [record, tick],
  );
  const stats = useMemo(
    () => computeHoldTimeStats(stageValues, 0, live?.allowedHoldTime || 24),
    [stageValues, live?.allowedHoldTime],
  );
  const weViolations = useMemo(() => detectWesternElectricViolations(stageValues), [stageValues]);
  const ewma = useMemo(() => computeEwma(stageValues), [stageValues]);
  const cusum = useMemo(() => computeCusum(stageValues, live?.allowedHoldTime), [stageValues, live?.allowedHoldTime]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !live) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title={live.holdStage}
        description={`${live.batchNumber} · ${live.productName} · ${live.holdTimeCode || live.holdTimeId}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Hold Time Monitoring', href: '/cpv/hold-time-monitoring' },
          { label: live.holdTimeId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/hold-time-monitoring')}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            {canReview && live.reviewStatus === 'Draft' && (
              <Button size="sm" onClick={async () => {
                const { error: err } = await reviewHoldTimeRecord(live.id, actor);
                if (err) toast.error(err); else { toast.success('Submitted for review'); await load(); }
              }}>Submit Review</Button>
            )}
            {canReview && live.reviewStatus === 'Under Review' && (
              <Button size="sm" onClick={() => { setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: `/cpv/product-master?search=${encodeURIComponent(live.productCode || live.productName)}`, label: 'Product Master' },
          { href: `/cpv/batch-registration?search=${encodeURIComponent(live.batchNumber)}`, label: 'Batch' },
          { href: `/cpv/cpp?batch=${encodeURIComponent(live.batchNumber)}`, label: 'CPP' },
          { href: `/cpv/cqa?batch=${encodeURIComponent(live.batchNumber)}`, label: 'CQA' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Actual / Elapsed" value={`${live.actualHoldTime} ${live.holdTimeUnit}`} />
        <KpiCard label="Allowed" value={`${live.allowedHoldTime} ${live.holdTimeUnit}`} />
        <KpiCard
          label="Remaining"
          value={!live.endDateTime ? formatCountdown(live.remainingTime, live.holdTimeUnit) : `${live.remainingTime} ${live.holdTimeUnit}`}
          tone={live.remainingTime <= 0 ? 'red' : live.nearExpiry ? 'amber' : 'green'}
        />
        <KpiCard label="Utilization" value={`${live.timeUtilizationPercent}%`} tone={live.timeUtilizationPercent >= 95 ? 'red' : live.timeUtilizationPercent >= 80 ? 'amber' : 'green'} />
        <KpiCard label="Status" value={live.status} tone={live.status === 'Complies' || live.status === 'In Progress' ? 'green' : 'red'} />
        <KpiCard label="Timer" value={live.timerStatus} />
        <KpiCard label="Cpk (stage)" value={stats.cpk ?? '—'} />
        <KpiCard label="WE Violations" value={weViolations.length} tone={weViolations.length ? 'red' : 'green'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Hold Details</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Product</span><span>{live.productName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Batch</span><span>{live.batchNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Category</span><span>{live.materialCategory}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Process Stage</span><span>{live.processStage}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Start</span><span>{live.startDateTime}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">End</span><span>{live.endDateTime || 'In progress'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Storage</span><span>{live.storageLocation || live.storageCondition || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Temp / RH</span><span>{live.temperature ?? '—'} / {live.humidity ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Risk</span><RiskBadge level={live.riskLevel} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Review</span><span>{live.reviewStatus}</span></div>
            {live.linkedDeviationNumber && (
              <div className="flex justify-between"><span className="text-muted-foreground">Deviation</span><span>{live.linkedDeviationNumber}</span></div>
            )}
            {live.capaRequired && (
              <div className="flex justify-between"><span className="text-muted-foreground">CAPA</span><span className="text-amber-700">Suggested</span></div>
            )}
            {live.storageExcursion && (
              <div className="flex justify-between text-red-600"><span>Storage Excursion</span><span>Yes</span></div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Compliance & Calculations</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={live.status} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Exceeded Time</span><span>{live.exceededTime} {live.holdTimeUnit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Difference</span><span>{live.difference}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Reason</span><span>{live.reasonForHold || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Extension</span><span>{live.extensionApproved ? 'Yes' : 'No'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Remarks</span><span>{live.remarks || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Change Reason</span><span>{live.changeReason || '—'}</span></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Stage Trend</CardTitle></CardHeader>
        <CardContent><ParameterTrendChart data={trend} /></CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">SPC Statistics</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <div>Mean: {stats.mean}</div>
            <div>Median: {stats.median}</div>
            <div>Mode: {stats.mode ?? '—'}</div>
            <div>Std Dev: {stats.stdDev}</div>
            <div>Cp / Cpk: {stats.cp ?? '—'} / {stats.cpk ?? '—'}</div>
            <div>Pp / Ppk: {stats.pp ?? '—'} / {stats.ppk ?? '—'}</div>
            <div>Sigma: {stats.sigmaLevel ?? '—'}</div>
            <div>n: {stats.count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">EWMA / CUSUM (last 5)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>EWMA: {ewma.slice(-5).join(', ') || '—'}</p>
            <p>CUSUM+: {cusum.high.slice(-5).join(', ') || '—'}</p>
            <p>CUSUM−: {cusum.low.slice(-5).join(', ') || '—'}</p>
            <p>Western Electric points: {weViolations.length ? weViolations.join(', ') : 'None'}</p>
          </CardContent>
        </Card>
      </div>

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

      <Dialog open={approveOpen && !esignOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Hold Time Record</DialogTitle>
            <p className="text-sm text-muted-foreground">Electronic signature required (21 CFR Part 11).</p>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={approveReason} onChange={(e) => setApproveReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)}>Cancel</Button>
            <Button onClick={() => {
              if (approveReason.trim().length < 5) { toast.error('Change reason must be at least 5 characters'); return; }
              setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="Hold Time Monitoring"
        recordId={live.id}
        documentNumber={live.holdTimeId}
        actionType="Approve"
        onSuccess={async () => {
          setEsignOpen(false);
          const { error: err } = await approveHoldTimeRecord(live.id, actor, approveReason, { esignConfirmed: true });
          if (err) toast.error(err);
          else { toast.success('Approved'); setApproveOpen(false); await load(); }
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
