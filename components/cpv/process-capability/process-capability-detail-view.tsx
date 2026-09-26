'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchProcessCapabilityById, fetchProcessCapabilityAuditTrail,
  approveProcessCapability, reviewProcessCapability, rejectProcessCapability,
  recalculateProcessCapability,
} from '@/lib/cpv-process-capability-service';
import {
  buildHistogramBins, buildIndividualsChart, buildMovingRangeChart,
  computeEwma, computeCusum, detectWesternElectricViolations, detectNelsonRuleViolations,
  goldenBatchComparison, forecastNextCpk,
  type ProcessCapabilityRecord,
} from '@/lib/cpv-process-capability';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import {
  CapabilityChart, CapabilityHistogram, IndividualsChart, MovingRangeChart,
} from './capability-chart';
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

export function ProcessCapabilityDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewProcessCapability(profile?.role);
  const canEdit = cpvPermissions.canEditProcessCapability(profile?.role);
  const [record, setRecord] = useState<ProcessCapabilityRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [approveReason, setApproveReason] = useState('');
  const [qaOverride, setQaOverride] = useState(false);
  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchProcessCapabilityById(id);
    if (!r) { setError('Record not found.'); setLoading(false); return; }
    setRecord(r);
    setAudit(await fetchProcessCapabilityAuditTrail(id));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const values = useMemo(() => record?.sourcePreview || [], [record?.sourcePreview]);
  const histogram = useMemo(() => buildHistogramBins(values), [values]);
  const individuals = useMemo(() => buildIndividualsChart(values), [values]);
  const mrChart = useMemo(() => buildMovingRangeChart(values), [values]);
  const ewma = useMemo(() => computeEwma(values), [values]);
  const cusum = useMemo(() => computeCusum(values, record?.targetValue), [values, record?.targetValue]);
  const we = useMemo(() => detectWesternElectricViolations(values), [values]);
  const nelson = useMemo(() => detectNelsonRuleViolations(values), [values]);
  const golden = useMemo(
    () => goldenBatchComparison(values, values.map(() => record?.batchNumber || 'batch')),
    [values, record?.batchNumber],
  );
  const forecast = useMemo(() => forecastNextCpk([record?.cpk || 0].filter(Boolean)), [record?.cpk]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  const chartData = [{ label: record.parameterName, cp: record.cp, cpk: record.cpk, ppk: record.ppk }];

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title={record.parameterName}
        description={`${record.productName} · ${record.parameterType} · ${record.capabilityCode || record.capabilityId}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Process Capability', href: '/cpv/process-capability' },
          { label: record.capabilityId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/process-capability')}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            {canEdit && (!record.isLocked || canReview) && record.status !== 'Approved' && (
              <Button size="sm" variant="outline" onClick={async () => {
                const reason = window.prompt('Change reason (min 5 chars)');
                if (!reason || reason.trim().length < 5) { toast.error('Change reason required'); return; }
                const { error: err } = await recalculateProcessCapability(record.id, actor, record, false, { changeReason: reason });
                if (err) toast.error(err); else { toast.success('Recalculated'); await load(); }
              }}>Recalculate</Button>
            )}
            {canReview && record.isLocked && record.status === 'Approved' && (
              <Button size="sm" variant="outline" onClick={() => {
                setQaOverride(true); setApproveReason(''); setApproveOpen(true);
              }}>QA Override Recalculate</Button>
            )}
            {canReview && record.status === 'Calculated' && (
              <Button size="sm" onClick={async () => {
                const { error: err } = await reviewProcessCapability(record.id, actor);
                if (err) toast.error(err); else { toast.success('Submitted'); await load(); }
              }}>Submit Review</Button>
            )}
            {canReview && record.status === 'Under Review' && (
              <>
                <Button size="sm" onClick={() => { setQaOverride(false); setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={async () => {
                  const reason = window.prompt('Rejection reason (min 5 chars)');
                  if (!reason || reason.trim().length < 5) { toast.error('Reason required'); return; }
                  const { error: err } = await rejectProcessCapability(record.id, actor, reason);
                  if (err) toast.error(err); else { toast.success('Rejected'); await load(); }
                }}>Reject</Button>
              </>
            )}
          </>
        }
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: `/cpv/cpp?product=${encodeURIComponent(record.productCode || record.productName)}`, label: 'CPP' },
          { href: `/cpv/cqa?product=${encodeURIComponent(record.productCode || record.productName)}`, label: 'CQA' },
          { href: '/cpv/yield-monitoring', label: 'Yield' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Cpk" value={record.cpk} tone={record.cpk >= 1.33 ? 'green' : 'amber'} />
        <KpiCard label="Cp" value={record.cp} />
        <KpiCard label="Ppk" value={record.ppk} />
        <KpiCard label="Pp" value={record.pp} />
        <KpiCard label="Cpu / Cpl" value={`${record.cpu} / ${record.cpl}`} />
        <KpiCard label="Ppu / Ppl" value={`${record.ppu} / ${record.ppl}`} />
        <KpiCard label="Sigma Level" value={record.sigmaLevel} />
        <KpiCard label="AI Health Score" value={record.healthScore} tone="blue" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Statistics</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Mean / Median / Mode</span><span>{record.mean} / {record.median} / {record.mode ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Min / Max / Range</span><span>{record.minimumValue} / {record.maximumValue} / {record.range}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Variance / Std Dev</span><span>{record.variance} / {record.standardDeviation}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Within SD / MR-bar</span><span>{record.withinStandardDeviation} / {record.movingRangeBar}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Skewness / Kurtosis</span><span>{record.skewness} / {record.kurtosis}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">95% CI</span><span>{record.confidenceIntervalLow} – {record.confidenceIntervalHigh}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Z (LSL/USL)</span><span>{record.zScoreLsl} / {record.zScoreUsl}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Normality p≈</span><span>{record.normalityPValue ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Outliers</span><span>{record.outlierCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Samples / Batches</span><span>{record.sampleCount} / {record.batchCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">LSL / USL</span><span>{record.lowerSpecificationLimit} – {record.upperSpecificationLimit}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Assessment & AI</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Capability</span><StatusBadge status={record.capabilityStatus} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Risk</span><RiskBadge level={record.riskLevel} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Workflow</span><span>{record.status}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Review Period</span><span>{record.reviewPeriodFrom} → {record.reviewPeriodTo}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Data Source</span><span>{record.dataSource}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">PPI</span><span>{record.processPerformanceIndex}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Forecast Cpk</span><span>{forecast.next}</span></div>
            {golden && <div className="flex justify-between"><span className="text-muted-foreground">Golden Batch</span><span>{golden.goldenBatch} (Δ {golden.delta})</span></div>}
            {record.capaRecommended && <p className="text-amber-700">CAPA recommended</p>}
            {record.deviationRequired && <p className="text-red-700">Deviation required</p>}
            <p className="text-muted-foreground mt-2">{record.aiRecommendation || '—'}</p>
            {record.conclusion && <p className="text-muted-foreground">{record.conclusion}</p>}
            {record.recommendation && <p>{record.recommendation}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Capability Indices</CardTitle></CardHeader>
        <CardContent><CapabilityChart data={chartData} /></CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Histogram</CardTitle></CardHeader>
          <CardContent><CapabilityHistogram data={histogram} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Individuals (I) Chart</CardTitle></CardHeader>
          <CardContent><IndividualsChart data={individuals} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Moving Range Chart</CardTitle></CardHeader>
          <CardContent><MovingRangeChart data={mrChart} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">EWMA / CUSUM / Rules</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>EWMA (last 5): {ewma.slice(-5).join(', ') || '—'}</p>
            <p>CUSUM+ (last 5): {cusum.high.slice(-5).join(', ') || '—'}</p>
            <p>CUSUM− (last 5): {cusum.low.slice(-5).join(', ') || '—'}</p>
            <p>Western Electric points: {we.length ? we.join(', ') : 'None'}</p>
            <p>Nelson rules: {nelson.length ? nelson.map((n) => n.rule).join('; ') : 'None'}</p>
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
            <DialogTitle>{qaOverride ? 'QA Override Recalculate' : 'Approve Capability'}</DialogTitle>
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
        moduleName="Process Capability"
        recordId={record.id}
        documentNumber={record.capabilityId}
        actionType={qaOverride ? 'QA Override' : 'Approve'}
        onSuccess={async () => {
          setEsignOpen(false);
          if (qaOverride) {
            const { error: err } = await recalculateProcessCapability(record.id, actor, record, true, {
              esignConfirmed: true, changeReason: approveReason,
            });
            if (err) toast.error(err); else { toast.success('Recalculated'); setApproveOpen(false); await load(); }
          } else {
            const { error: err } = await approveProcessCapability(record.id, actor, approveReason, { esignConfirmed: true });
            if (err) toast.error(err); else { toast.success('Approved'); setApproveOpen(false); await load(); }
          }
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
