'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchSpcRecordById, fetchSpcAuditTrail,
  approveSpcRecord, reviewSpcRecord, rejectSpcRecord,
  regenerateSpcRecord,
} from '@/lib/cpv-spc-service';
import type { SpcRecord } from '@/lib/cpv-spc-records';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ControlChart, MovingRangeChart } from './control-chart';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

function SpcStatusBadge({ status }: { status: string }) {
  const cls = status === 'Out Of Control' ? 'bg-red-50 text-red-700 border-red-200'
    : status === 'Warning' ? 'bg-amber-50 text-amber-700 border-amber-200'
      : status === 'In Control' ? 'bg-green-50 text-green-700 border-green-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

export function SpcDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewSpc(profile?.role);
  const canEdit = cpvPermissions.canEditSpc(profile?.role) || cpvPermissions.canCreateSpc(profile?.role);
  const [record, setRecord] = useState<SpcRecord | null>(null);
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
    setError(null);
    const r = await fetchSpcRecordById(id);
    if (!r || r.isDeleted) { setError('Record not found.'); setLoading(false); return; }
    setRecord(r);
    setAudit(await fetchSpcAuditTrail(id));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={1} />;
  if (error || !record) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  const productKey = record.productCode || record.productName;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title={record.parameterName || record.spcRecordId}
        description={`${record.productName} · ${record.chartType} · ${record.spcRecordId}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/statistical-process-control')}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            {canEdit && record.status !== 'Approved' && (
              <Button size="sm" variant="outline" onClick={async () => {
                const reason = window.prompt('Change reason (min 5 chars)');
                if (!reason || reason.trim().length < 5) { toast.error('Change reason required'); return; }
                const { error: err } = await regenerateSpcRecord(record.id, actor, record, false, { changeReason: reason });
                if (err) toast.error(err); else { toast.success('Regenerated'); await load(); }
              }}>Regenerate</Button>
            )}
            {canReview && record.isLocked && record.status === 'Approved' && (
              <Button size="sm" variant="outline" onClick={() => {
                setQaOverride(true); setApproveReason(''); setApproveOpen(true);
              }}>QA Override</Button>
            )}
            {canReview && record.status === 'Generated' && (
              <Button size="sm" onClick={async () => {
                const { error: err } = await reviewSpcRecord(record.id, actor, record);
                if (err) toast.error(err); else { toast.success('Submitted for review'); await load(); }
              }}>Submit Review</Button>
            )}
            {canReview && record.status === 'Under Review' && (
              <>
                <Button size="sm" onClick={() => { setQaOverride(false); setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={async () => {
                  const reason = window.prompt('Rejection reason (min 5 chars)');
                  if (!reason || reason.trim().length < 5) { toast.error('Reason required'); return; }
                  const { error: err } = await rejectSpcRecord(record.id, actor, record, reason);
                  if (err) toast.error(err); else { toast.success('Rejected'); await load(); }
                }}>Reject</Button>
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
          { href: '/cpv/process-capability', label: 'Process Capability' },
          { href: '/cpv/trend-analysis', label: 'Trend Analysis' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Center Line" value={record.centerLine} />
        <KpiCard label="UCL / LCL" value={`${record.upperControlLimit} / ${record.lowerControlLimit}`} />
        <KpiCard label="Cpk" value={record.cpk} tone={record.cpk >= 1.33 ? 'green' : 'amber'} />
        <KpiCard label="Health Score" value={record.healthScore} tone="blue" />
        <KpiCard label="Violations" value={record.ruleViolationsCount} tone={record.ruleViolationsCount ? 'red' : 'green'} />
        <KpiCard label="OOC Points" value={record.outOfControlPoints} tone={record.outOfControlPoints ? 'red' : 'green'} />
        <KpiCard label="Sigma Level" value={record.sigmaLevel} />
        <KpiCard label="Confidence" value={record.confidenceScore} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Statistics</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Mean / Median</span><span>{record.mean} / {record.median}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Std Dev / Variance</span><span>{record.standardDeviation} / {record.variance}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Range</span><span>{record.range}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">MR-bar</span><span>{record.movingRangeAverage}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cp / Cpk</span><span>{record.cp} / {record.cpk}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Pp / Ppk</span><span>{record.pp} / {record.ppk}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">LSL / USL</span><span>{record.lowerSpecificationLimit} – {record.upperSpecificationLimit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Samples / Batches</span><span>{record.dataPointsCount} / {record.batchCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Skewness / Kurtosis</span><span>{record.skewness} / {record.kurtosis}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Outliers</span><span>{record.outlierCount}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Assessment</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">SPC Status</span><SpcStatusBadge status={record.spcStatus} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Risk</span><RiskBadge level={record.riskLevel} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Workflow</span><span>{record.status}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Chart Type</span><span>{record.chartType}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Data Source</span><span>{record.dataSource}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Review Period</span><span>{record.reviewPeriodFrom} → {record.reviewPeriodTo}</span></div>
            {record.processDriftDetected && <p className="text-amber-700">Process drift detected</p>}
            {record.specialCauseVariation && <p className="text-amber-700">Special cause variation detected</p>}
            {record.capaSuggested && <p className="text-amber-700">CAPA suggested</p>}
            {record.deviationRequired && <p className="text-red-700">Deviation required</p>}
            <p className="mt-2 text-muted-foreground">{record.aiRecommendation || '—'}</p>
            {record.conclusion && <p className="text-muted-foreground">{record.conclusion}</p>}
            {record.recommendation && <p>{record.recommendation}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Individuals Chart</CardTitle></CardHeader>
        <CardContent>
          <ControlChart
            data={record.chartData}
            lsl={record.lowerSpecificationLimit || undefined}
            usl={record.upperSpecificationLimit || undefined}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Moving Range Chart</CardTitle></CardHeader>
        <CardContent>
          <MovingRangeChart data={record.movingRangeData} />
        </CardContent>
      </Card>

      {record.violations.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Rule Violations</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.violations.map((v) => (
                  <TableRow key={v.violationId}>
                    <TableCell>{v.batchNumber}</TableCell>
                    <TableCell>{v.ruleDescription}</TableCell>
                    <TableCell>{v.severity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
            <DialogTitle>{qaOverride ? 'QA Override Recalculate' : 'Approve SPC Record'}</DialogTitle>
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
        moduleName="Statistical Process Control"
        recordId={record.id}
        documentNumber={record.spcRecordId}
        actionType={qaOverride ? 'QA Override' : 'Approve'}
        onSuccess={async () => {
          setEsignOpen(false);
          if (qaOverride) {
            const { error: err } = await regenerateSpcRecord(record.id, actor, record, true, {
              esignConfirmed: true, changeReason: approveReason,
            });
            if (err) toast.error(err); else { toast.success('Regenerated'); setApproveOpen(false); await load(); }
          } else {
            const { error: err } = await approveSpcRecord(record.id, actor, record, approveReason, { esignConfirmed: true });
            if (err) toast.error(err); else { toast.success('Approved'); setApproveOpen(false); await load(); }
          }
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
