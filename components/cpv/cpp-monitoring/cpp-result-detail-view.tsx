'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchCppResultById, fetchCppAuditTrail, approveCppResult, reviewCppResult,
  parameterTrendData, fetchCppResults,
} from '@/lib/cpv-cpp-monitoring-service';
import type { CppResultRecord } from '@/lib/cpv-cpp-monitoring';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ParameterTrendChart } from './parameter-trend-chart';
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

export function CppResultDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewCpp(profile?.role);
  const [record, setRecord] = useState<CppResultRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [trend, setTrend] = useState<ReturnType<typeof parameterTrendData>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveReason, setApproveReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchCppResultById(id);
    if (!r) { setError('CPP result not found.'); setLoading(false); return; }
    setRecord(r);
    const [auditRows, all] = await Promise.all([fetchCppAuditTrail(id), fetchCppResults()]);
    setAudit(auditRows);
    setTrend(parameterTrendData(all, r.parameterName));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const applyApprove = async () => {
    if (!record) return;
    setSubmitting(true);
    const { error: err } = await approveCppResult(record.id, actor, record, approveReason, { esignConfirmed: true });
    setSubmitting(false);
    setEsignOpen(false);
    setApproveOpen(false);
    setApproveReason('');
    if (err) toast.error(err);
    else {
      toast.success('CPP result approved');
      await load();
    }
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title={record.parameterName}
        description={`${record.batchNumber} · ${record.productName}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'CPP Monitoring', href: '/cpv/cpp' },
          { label: record.cppResultId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/cpp')}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
            {canReview && record.reviewStatus === 'Draft' && (
              <Button size="sm" onClick={async () => {
                const { error: err } = await reviewCppResult(record.id, actor, record);
                if (err) toast.error(err);
                else { toast.success('Submitted for review'); await load(); }
              }}>Submit Review</Button>
            )}
            {canReview && (record.reviewStatus === 'Under Review' || record.reviewStatus === 'Draft') && (
              <Button size="sm" onClick={() => { setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
            )}
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={record.status} />
        <StatusBadge status={record.riskLevel} />
        <StatusBadge status={record.reviewStatus} />
      </div>

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          ...(record.cpvProductId
            ? [{ href: `/cpv/product-master/${record.cpvProductId}`, label: 'Product Master' }]
            : [{ href: `/cpv/product-master?search=${encodeURIComponent(record.productCode)}`, label: 'Product Master' }]),
          { href: `/cpv/batch-registration?product=${encodeURIComponent(record.productCode)}`, label: 'Batch Details' },
          { href: '/qms/equipment', label: 'Equipment' },
          { href: '/cpv/trend-analysis', label: 'Trend Analysis' },
          { href: '/cpv/control-charts', label: 'SPC Dashboard' },
          { href: `/cpv/cqa?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CQA Monitoring' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/qms/change-control', label: 'Change Control' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
          { href: '/cpv/ai-analytics', label: 'Analytics' },
        ].map((l) => (
          <Link
            key={l.href}
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
        <KpiCard label="Limits" value={`${record.lowerLimit} – ${record.upperLimit}`} tone="amber" />
        <KpiCard label="Deviation" value={record.linkedDeviationNumber || '—'} tone="red" />
      </div>
      <Card>
        <CardHeader><CardTitle>Result Details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[
            ['CPP Result ID', record.cppResultId],
            ['Product Version', record.productVersion],
            ['Process Stage', record.processStage],
            ['Area', record.processArea],
            ['Parameter Code', record.parameterCode],
            ['Criticality', record.criticality],
            ['Equipment', record.equipmentName || record.equipmentId],
            ['Site / Dept / Shift', `${record.site || '—'} / ${record.department || '—'} / ${record.shift || '—'}`],
            ['UCL / LCL', `${record.ucl ?? '—'} / ${record.lcl ?? '—'}`],
            ['Observation', record.observationDateTime],
            ['Recorded By', record.recordedBy],
            ['Reviewed By', record.reviewedBy],
            ['CAPA Required', record.capaRequired ? 'Yes' : 'No'],
            ['Remarks', record.remarks],
          ].map(([l, v]) => (
            <div key={l}><p className="text-xs text-muted-foreground">{l}</p><p>{v || '—'}</p></div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Parameter Trend</CardTitle></CardHeader>
        <CardContent>
          {trend.length ? <ParameterTrendChart data={trend} /> : <EmptyState title="No trend data" />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
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
                      <TableCell className="text-xs">{String(a.timestamp || a.dateTime || '—')}</TableCell>
                      <TableCell>{String(a.actionType || a.action || '—')}</TableCell>
                      <TableCell>{String(a.userName || a.performedBy || '—')}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs">{String(a.actionDescription || a.reason || '—')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={approveOpen && !esignOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve CPP Result</DialogTitle>
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
              setEsignOpen(true);
            }}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={setEsignOpen}
        moduleName="CPP Monitoring"
        recordId={record.id}
        documentNumber={record.cppResultId}
        actionType="Approve"
        onSuccess={() => { void applyApprove(); }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
