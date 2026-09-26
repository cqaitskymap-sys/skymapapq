'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchTrendAnalysisById, fetchTrendAnalysisAuditTrail,
  approveTrendAnalysis, reviewTrendAnalysis, rejectTrendAnalysis,
  regenerateTrendAnalysis, logTrendExport,
} from '@/lib/cpv-trend-analysis-service';
import type { TrendAnalysisRecord } from '@/lib/cpv-trend-records';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ParameterTrendChart } from './parameter-trend-chart';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

function TrendStatusBadge({ status }: { status: string }) {
  const cls = status === 'OOS' ? 'bg-red-50 text-red-700 border-red-200'
    : status === 'OOT' || status === 'Action Required' ? 'bg-orange-50 text-orange-700 border-orange-200'
      : status === 'Alert' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

export function TrendAnalysisDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewTrendAnalysis(profile?.role);
  const canCreate = cpvPermissions.canCreateTrendAnalysis(profile?.role);
  const canEdit = cpvPermissions.canEditTrendAnalysis(profile?.role) || canCreate;
  const canExport = cpvPermissions.canImportExportTrendAnalysis(profile?.role);
  const [record, setRecord] = useState<TrendAnalysisRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [esignOpen, setEsignOpen] = useState(false);
  const [qaOverride, setQaOverride] = useState(false);
  const [approveReason, setApproveReason] = useState('');
  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchTrendAnalysisById(id);
    if (!r || r.isDeleted) { setError('Record not found.'); setLoading(false); return; }
    setRecord(r);
    const auditRows = await fetchTrendAnalysisAuditTrail(id);
    setAudit(auditRows);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  const productKey = record.productCode || record.productName;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title={record.parameterName}
        description={`${record.productName} · ${record.trendType} · ${record.trendId}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Trend Analysis', href: '/cpv/trend-analysis' },
          { label: record.trendId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/trend-analysis')}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            {canExport && (
              <>
                <Button size="sm" variant="outline" onClick={() => {
                  printPage();
                  void logTrendExport(actor, 'chart', 1);
                  toast.success('Print dialog opened for chart export');
                }}>
                  Export Chart
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  printPage();
                  void logTrendExport(actor, 'PDF', 1);
                  toast.success('Print dialog opened for PDF export');
                }}>
                  Export PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const rows = (record.sourcePreview.length ? record.sourcePreview : record.chartData).map((p) => [
                    p.batchNumber, p.date, p.value, p.lsl ?? '', p.usl ?? '', p.target ?? '',
                  ]);
                  downloadCsv(
                    `trend-${record.trendId || record.id}.csv`,
                    ['Batch', 'Date', 'Value', 'LSL', 'USL', 'Target'],
                    rows,
                  );
                  void logTrendExport(actor, 'Excel', rows.length);
                  toast.success(`Exported ${rows.length} data points`);
                }}>
                  Export Excel
                </Button>
              </>
            )}
            {canEdit && record.status !== 'Approved' && (
              <Button size="sm" variant="outline" onClick={async () => {
                const reason = window.prompt('Change reason (min 5 chars)');
                if (!reason || reason.trim().length < 5) { toast.error('Change reason required'); return; }
                const { error: err } = await regenerateTrendAnalysis(record.id, actor, record, false, { changeReason: reason });
                if (err) toast.error(err); else { toast.success('Regenerated'); await load(); }
              }}>Re-generate</Button>
            )}
            {canReview && record.isLocked && record.status === 'Approved' && (
              <Button size="sm" variant="outline" onClick={() => {
                setQaOverride(true); setApproveReason(''); setApproveOpen(true);
              }}>QA Override</Button>
            )}
            {canReview && record.status === 'Generated' && (
              <Button size="sm" onClick={async () => {
                const { error: err } = await reviewTrendAnalysis(record.id, actor, record);
                if (err) toast.error(err); else { toast.success('Submitted for review'); await load(); }
              }}>Submit Review</Button>
            )}
            {canReview && record.status === 'Under Review' && (
              <>
                <Button size="sm" onClick={() => { setQaOverride(false); setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
                <Button size="sm" variant="destructive" onClick={async () => {
                  const reason = window.prompt('Rejection reason (min 5 chars)');
                  if (!reason || reason.trim().length < 5) { toast.error('Reason required'); return; }
                  const { error: err } = await rejectTrendAnalysis(record.id, actor, record, reason);
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
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/ai-analytics', label: 'AI Analytics' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Mean" value={record.mean} />
        <KpiCard label="Median" value={record.median} />
        <KpiCard label="Std Dev" value={record.standardDeviation} />
        <KpiCard label="Health Score" value={record.healthScore} tone="blue" />
        <KpiCard label="Forecast Next" value={record.forecastNext} />
        <KpiCard label="Cpk" value={record.cpk || '—'} tone={record.cpk >= 1.33 ? 'green' : 'amber'} />
        <KpiCard label="Confidence" value={record.confidenceScore} />
        <KpiCard label="OOT / OOS" value={`${record.ootCount} / ${record.oosCount}`} tone={record.oosCount ? 'red' : 'amber'} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Trend Chart</CardTitle></CardHeader>
        <CardContent>
          <ParameterTrendChart
            data={record.chartData}
            title={`${record.parameterName} trend`}
            height={360}
            ucl={record.ucl}
            lcl={record.lcl}
          />
        </CardContent>
      </Card>

      {record.sourcePreview?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Batch-to-Batch Source Data</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>LSL</TableHead>
                  <TableHead>USL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.sourcePreview.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell>{p.batchNumber}</TableCell>
                    <TableCell>{p.value}</TableCell>
                    <TableCell>{p.date}</TableCell>
                    <TableCell>{Number.isFinite(p.lsl) ? p.lsl : '—'}</TableCell>
                    <TableCell>{Number.isFinite(p.usl) ? p.usl : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Statistics & SPC</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Mean / Median / Mode</span><span>{record.mean} / {record.median} / {record.mode ?? '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Min / Max / Range</span><span>{record.minimumValue} / {record.maximumValue} / {record.range}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Variance / Std Dev</span><span>{record.variance} / {record.standardDeviation}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">MA / WA / Rolling</span><span>{record.movingAverage} / {record.weightedAverage} / {record.rollingAverage}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Regression slope / R²</span><span>{record.regressionSlope} / {record.regressionR2}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Correlation / Covariance</span><span>{record.correlation} / {record.covariance}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">UCL / LCL</span><span>{record.ucl} / {record.lcl}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">EWMA / CUSUM±</span><span>{record.ewmaLast} / {record.cusumHighLast} · {record.cusumLowLast}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cp / Cpk / Pp / Ppk</span><span>{record.cp} / {record.cpk} / {record.pp} / {record.ppk}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Z / Sigma / Outliers</span><span>{record.zScoreMean} / {record.sigmaLevel} / {record.outlierCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Data Points / Batches</span><span>{record.dataPointsCount} / {record.batchCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Review Period</span><span>{record.reviewPeriodFrom} → {record.reviewPeriodTo}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Assessment & AI</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Direction</span><span>{record.trendDirection}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Trend Status</span><TrendStatusBadge status={record.trendStatus} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Risk</span><RiskBadge level={record.riskLevel} /></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Workflow</span><span>{record.status}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Data Source</span><span>{record.dataSource}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Forecast series</span><span>{(record.forecastSeries || []).join(', ') || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Golden Batch</span><span>{record.goldenBatchNumber || '—'}{record.goldenBatchDelta ? ` (Δ ${record.goldenBatchDelta})` : ''}</span></div>
            {record.processDriftDetected && <p className="text-amber-700">Process drift detected</p>}
            {record.qualityDegradation && <p className="text-amber-700">Quality degradation signal</p>}
            {record.capaSuggested && <p className="text-amber-700">CAPA suggested</p>}
            {record.deviationRequired && <p className="text-red-700">Deviation required</p>}
            <p className="text-muted-foreground mt-2">{record.aiRecommendation || '—'}</p>
            {record.conclusion && <p className="text-muted-foreground">{record.conclusion}</p>}
            {record.recommendation && <p>{record.recommendation}</p>}
            <div className="flex justify-between pt-2"><span className="text-muted-foreground">Generated</span><span>{record.generatedBy} · {record.generatedDate}</span></div>
            {record.approvedBy && <div className="flex justify-between"><span className="text-muted-foreground">Approved</span><span>{record.approvedBy} · {record.approvalDate}</span></div>}
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
            <DialogTitle>{qaOverride ? 'QA Override Re-generate' : 'Approve Trend Analysis'}</DialogTitle>
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
        moduleName="Trend Analysis"
        recordId={record.id}
        documentNumber={record.trendId}
        actionType={qaOverride ? 'QA Override' : 'Approve'}
        onSuccess={async () => {
          setEsignOpen(false);
          if (qaOverride) {
            const { error: err } = await regenerateTrendAnalysis(record.id, actor, record, true, {
              esignConfirmed: true, changeReason: approveReason,
            });
            if (err) toast.error(err); else { toast.success('Regenerated'); setApproveOpen(false); await load(); }
          } else {
            const { error: err } = await approveTrendAnalysis(record.id, actor, record, approveReason, { esignConfirmed: true });
            if (err) toast.error(err); else { toast.success('Approved'); setApproveOpen(false); await load(); }
          }
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
