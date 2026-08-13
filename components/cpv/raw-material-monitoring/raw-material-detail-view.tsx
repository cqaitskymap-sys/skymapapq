'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  fetchRawMaterialRecordById, fetchRawMaterialAuditTrail,
  approveRawMaterialRecord, reviewRawMaterialRecord, updateRawMaterialRecord,
} from '@/lib/cpv-raw-material-monitoring-service';
import type { RawMaterialMonitoringRecord, RawMaterialAttachment } from '@/lib/cpv-raw-material-monitoring';
import type { RawMaterialActor } from '@/lib/cpv-raw-material-monitoring-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { AttachmentUploader } from './attachment-uploader';
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

function AvlBadge({ status }: { status: string }) {
  const ok = ['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(status);
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{status}</span>;
}

function RiskBadge({ level }: { level: string }) {
  const cls = level === 'Critical' ? 'bg-red-900/10 text-red-900 border-red-300'
    : level === 'High' ? 'bg-red-50 text-red-700 border-red-200'
      : level === 'Medium' ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>;
}

async function callReview(id: string, actor: RawMaterialActor, changeReason = 'Submitted for QA review') {
  return reviewRawMaterialRecord(id, actor, changeReason);
}

async function callApprove(
  id: string,
  actor: RawMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return approveRawMaterialRecord(id, actor, changeReason, options);
}

export function RawMaterialDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewRawMaterial(profile?.role);
  const canEdit = cpvPermissions.canUpdateRawMaterialQc(profile?.role) && !cpvPermissions.isRawMaterialViewOnly(profile?.role);
  const [record, setRecord] = useState<RawMaterialMonitoringRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState('Submitted for QA review');
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveReason, setApproveReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchRawMaterialRecordById(id);
    if (!r) { setError('Record not found.'); setLoading(false); return; }
    setRecord(r);
    setAudit(await fetchRawMaterialAuditTrail(id));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const onAttachmentsChange = async (attachments: RawMaterialAttachment[]) => {
    if (!record) return;
    const { result } = await updateRawMaterialRecord(record.id, { changeReason: 'Attachment update' } as never, actor, record, attachments);
    if (result) setRecord(result);
  };

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
      toast.success('Record approved');
      await load();
    }
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title={record.materialName}
        description={`${record.batchNumber} · ${record.productName}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Raw Material Monitoring', href: '/cpv/raw-material-monitoring' },
          { label: record.rawMaterialMonitoringId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/raw-material-monitoring')}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
            {canReview && record.reviewStatus === 'Draft' && (
              <Button size="sm" onClick={() => { setReviewReason('Submitted for QA review'); setReviewOpen(true); }}>Submit Review</Button>
            )}
            {canReview && (record.reviewStatus === 'Under Review' || record.reviewStatus === 'Draft') && (
              <Button size="sm" onClick={() => { setApproveReason(''); setApproveOpen(true); }}>Approve</Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={record.complianceStatus} />
        <RiskBadge level={record.riskLevel} />
        <StatusBadge status={record.qcStatus} />
        <AvlBadge status={record.avlStatus} />
        <StatusBadge status={record.reviewStatus} />
        {record.complianceStatus === 'Alert' && <StatusBadge status="Alert" />}
        {record.complianceStatus === 'Action' && <StatusBadge status="Action" />}
        {record.oosRequired && <StatusBadge status="OOS" />}
      </div>

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          ...(record.cpvProductId
            ? [{ href: `/cpv/product-master/${record.cpvProductId}`, label: 'Product Master' }]
            : [{ href: `/cpv/product-master?search=${encodeURIComponent(record.productCode)}`, label: 'Product Master' }]),
          { href: `/cpv/batch-registration?product=${encodeURIComponent(record.productCode)}`, label: 'Batch Details' },
          { href: `/cpv/cpp?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CPP Monitoring' },
          { href: `/cpv/cqa?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CQA Monitoring' },
          { href: `/cpv/raw-material-monitoring?batch=${encodeURIComponent(record.batchNumber)}`, label: 'Raw Material List' },
          { href: '/qms/oos', label: 'OOS' },
          { href: '/qms/deviation', label: 'Deviation' },
          { href: '/qms/capa', label: 'CAPA' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
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
        <KpiCard label="Issue Qty" value={`${record.usedQuantity} ${record.unit}`} tone="blue" />
        <KpiCard label="Compliance" value={record.complianceStatus} tone={record.complianceStatus === 'Complies' ? 'green' : 'red'} />
        <KpiCard label="Risk Level" value={record.riskLevel} tone={record.riskLevel === 'Low' ? 'green' : 'red'} />
        <KpiCard label="OOS Ref" value={record.linkedOosNumber || '—'} tone="red" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Deviation Ref" value={record.linkedDeviationNumber || '—'} tone="amber" />
        <KpiCard label="CAPA Ref" value={record.linkedCapaNumber || '—'} tone="amber" />
        <KpiCard label="CAPA Required" value={record.capaRequired ? 'Yes' : 'No'} tone={record.capaRequired ? 'amber' : 'green'} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Material Details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[
            ['RM ID', record.rawMaterialMonitoringId],
            ['Product Code', record.productCode],
            ['Material Code', record.materialCode],
            ['Material Type', record.materialType],
            ['Material Grade', record.materialGrade],
            ['Vendor', record.vendorName],
            ['AVL Status', record.avlStatus],
            ['Vendor Status', record.vendorStatus],
            ['GRN', record.grnNumber],
            ['AR No', record.arNumber],
            ['COA No', record.coaNumber],
            ['Lot', record.materialLotNumber],
            ['Manufacturer', record.manufacturerName],
            ['Supplier', record.supplierName],
            ['Standard Qty', `${record.issuedQuantity} ${record.unit}`],
            ['Received Qty', `${record.receivedQuantity} ${record.unit}`],
            ['MFG / EXP', `${record.mfgDate} / ${record.expDate}`],
            ['Retest Date', record.retestDate],
            ['Storage', record.storageCondition],
            ['Spec No / STP', `${record.specificationNumber || '—'} / ${record.stpNumber || '—'}`],
            ['Test Parameter', record.testParameter],
            ['Observed / Limits', record.testParameter ? `${record.observedResult ?? '—'} (${record.lowerLimit ?? '—'} – ${record.upperLimit ?? '—'} ${record.testUnit || record.unit})` : '—'],
            ['COA Available', record.coaAvailable],
            ['Test Result Summary', record.testResultSummary],
            ['Remarks', record.remarks],
          ].map(([l, v]) => (
            <div key={l}><p className="text-xs text-muted-foreground">{l}</p><p>{v || '—'}</p></div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <AttachmentUploader
            recordId={record.id}
            uploadedBy={actor.name}
            attachments={record.attachments || []}
            onChange={(files) => void onAttachmentsChange(files)}
            disabled={!canEdit || record.isLocked}
          />
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
                      <TableCell>{String(a.userName || a.user_name || a.performedBy || '—')}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs">{String(a.actionDescription || a.reason || '—')}</TableCell>
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
            <DialogDescription>Change reason is required (ALCOA+ / Part 11).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button disabled={submitting} onClick={() => void applyReview()}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen && !esignOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Raw Material Record</DialogTitle>
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
        moduleName="Raw Material Monitoring"
        recordId={record.id}
        documentNumber={record.rawMaterialMonitoringId}
        actionType="Approve"
        onSuccess={() => { void applyApprove(); }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
