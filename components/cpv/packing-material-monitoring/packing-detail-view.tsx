'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import { isLabelCategory } from '@/lib/cpv-packing-material-monitoring';
import {
  fetchPackingMaterialRecordById, fetchPackingMaterialAuditTrail,
  approvePackingMaterialRecord, reviewPackingMaterialRecord, updatePackingMaterialRecord,
  softDeletePackingMaterialRecord,
} from '@/lib/cpv-packing-material-monitoring-service';
import type { PackingMaterialMonitoringRecord } from '@/lib/cpv-packing-material-monitoring';
import type { PackingMaterialActor } from '@/lib/cpv-packing-material-monitoring-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { PackingAttachmentUploader } from './attachment-uploader';
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

function ReconBadge({ status }: { status: string }) {
  const cls = status === 'Matched' ? 'bg-green-50 text-green-700 border-green-200'
    : status === 'Mismatch' ? 'bg-red-50 text-red-700 border-red-200'
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

async function callReview(id: string, actor: PackingMaterialActor, changeReason = 'Submitted for QA review') {
  return reviewPackingMaterialRecord(id, actor, changeReason);
}

async function callApprove(
  id: string,
  actor: PackingMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return approvePackingMaterialRecord(id, actor, changeReason, options);
}

async function callSoftDelete(
  id: string,
  actor: PackingMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  return softDeletePackingMaterialRecord(id, actor, changeReason, options);
}

function strField(raw: Record<string, unknown>, key: string): string {
  const v = raw[key];
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

export function PackingDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canReview = cpvPermissions.canReviewPackingMaterial(profile?.role);
  const canEdit = cpvPermissions.canUpdatePackingMaterialQc(profile?.role) && !cpvPermissions.isPackingMaterialViewOnly(profile?.role);
  const [record, setRecord] = useState<PackingMaterialMonitoringRecord | null>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
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
    const r = await fetchPackingMaterialRecordById(id);
    if (!r || r.isDeleted) { setError('Record not found.'); setLoading(false); return; }
    setRecord(r);
    setAudit(await fetchPackingMaterialAuditTrail(id));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const onAttachmentsChange = async (attachments: PackingMaterialMonitoringRecord['attachments']) => {
    if (!record) return;
    const { result } = await updatePackingMaterialRecord(
      record.id,
      { changeReason: 'Attachment update' },
      actor,
      record,
      attachments,
    );
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
      router.push('/cpv/packing-material-monitoring');
    }
  };

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (error || !record) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Not found'} onRetry={load} /></div>;

  const raw = record as Record<string, unknown>;
  const labelWarning = isLabelCategory(record.materialCategory) && record.reconciliationStatus === 'Mismatch';
  const oos = Boolean(raw.oosRequired || raw.linkedOosNumber);
  const oot = Boolean(raw.ootRequired || raw.linkedOotNumber);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title={record.materialName}
        description={`${record.batchNumber} · ${record.productName}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Packing Material Monitoring', href: '/cpv/packing-material-monitoring' },
          { label: record.packingMaterialMonitoringId },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/packing-material-monitoring')}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
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

      {labelWarning && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          Critical: Label/package insert reconciliation mismatch — verify counts before batch release.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={record.complianceStatus} />
        <RiskBadge level={record.riskLevel} />
        <StatusBadge status={record.qcStatus} />
        <ReconBadge status={record.reconciliationStatus} />
        <AvlBadge status={record.avlStatus} />
        <StatusBadge status={record.reviewStatus} />
        {record.complianceStatus === 'Alert' && <StatusBadge status="Alert" />}
        {record.complianceStatus === 'Action' && <StatusBadge status="Action" />}
        {oos && <StatusBadge status="OOS" />}
        {oot && <StatusBadge status="OOT" />}
      </div>

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          ...(record.cpvProductId
            ? [{ href: `/cpv/product-master/${record.cpvProductId}`, label: 'Product Master' }]
            : [{ href: `/cpv/product-master?search=${encodeURIComponent(record.productCode)}`, label: 'Product Master' }]),
          { href: `/cpv/batch-registration?product=${encodeURIComponent(record.productCode)}`, label: 'Batch Details' },
          { href: `/cpv/cpp?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CPP Monitoring' },
          { href: `/cpv/cqa?batch=${encodeURIComponent(record.batchNumber)}`, label: 'CQA Monitoring' },
          { href: `/cpv/raw-material-monitoring?batch=${encodeURIComponent(record.batchNumber)}`, label: 'Raw Material' },
          { href: `/cpv/packing-material-monitoring?batch=${encodeURIComponent(record.batchNumber)}`, label: 'Packing Material List' },
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
        <KpiCard label="Standard Qty" value={`${record.issuedQuantity} ${record.unit}`} tone="blue" />
        <KpiCard label="Used" value={`${record.usedQuantity} ${record.unit}`} tone="green" />
        <KpiCard label="Balance" value={`${record.balanceQuantity} ${record.unit}`} tone={record.balanceQuantity === 0 ? 'green' : 'amber'} />
        <KpiCard label="Reconciliation" value={record.reconciliationStatus} tone={record.reconciliationStatus === 'Matched' ? 'green' : 'red'} />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Rejected" value={`${record.rejectedQuantity} ${record.unit}`} tone="amber" />
        <KpiCard label="Returned" value={`${record.returnedQuantity} ${record.unit}`} tone="blue" />
        <KpiCard label="Compliance" value={record.complianceStatus} tone={record.complianceStatus === 'Complies' ? 'green' : 'red'} />
        <KpiCard label="Risk Level" value={record.riskLevel} tone={record.riskLevel === 'Low' ? 'green' : 'red'} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Deviation Ref" value={record.linkedDeviationNumber || '—'} tone="amber" />
        <KpiCard label="CAPA Ref" value={record.linkedCapaNumber || '—'} tone="amber" />
        <KpiCard label="OOS Ref" value={strField(raw, 'linkedOosNumber')} tone="red" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Material Details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[
            ['PM ID', record.packingMaterialMonitoringId],
            ['Product Code', record.productCode],
            ['Material Code', record.materialCode],
            ['Material Type', record.materialType],
            ['Category', record.materialCategory],
            ['Vendor', record.vendorName],
            ['AVL Status', record.avlStatus],
            ['GRN', record.grnNumber],
            ['AR No', record.arNumber],
            ['Lot', record.materialLotNumber],
            ['PO Number', strField(raw, 'purchaseOrderNumber')],
            ['Supplier Batch', strField(raw, 'supplierBatchNumber')],
            ['Warehouse Location', strField(raw, 'warehouseLocation')],
            ['Accepted Qty', strField(raw, 'acceptedQuantity')],
            ['Quarantine Qty', strField(raw, 'quarantineQuantity')],
            ['MFG / EXP', `${record.mfgDate} / ${record.expDate}`],
            ['Storage', record.storageCondition],
            ['Spec No / STP', `${record.specificationNumber || '—'} / ${record.stpNumber || '—'}`],
            ['Test Parameter', strField(raw, 'testParameter')],
            ['Observed / Limits', raw.testParameter ? `${strField(raw, 'observedResult')} (${strField(raw, 'lowerLimit')} – ${strField(raw, 'upperLimit')} ${strField(raw, 'testUnit') || record.unit})` : '—'],
            ['Test Result Summary', record.testResultSummary],
            ['Remarks', record.remarks],
          ].map(([l, v]) => (
            <div key={l}><p className="text-xs text-muted-foreground">{l}</p><p>{v || '—'}</p></div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Artwork & Barcode Verification</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {[
            ['Artwork Version', strField(raw, 'artworkVersion')],
            ['Barcode', strField(raw, 'barcode')],
            ['QR Code', strField(raw, 'qrCode')],
            ['Artwork Verified', strField(raw, 'artworkVerified')],
            ['Barcode Verified', strField(raw, 'barcodeVerified')],
            ['Packaging Integrity', strField(raw, 'packagingIntegrity')],
            ['Damage Inspection', strField(raw, 'damageInspection')],
          ].map(([l, v]) => (
            <div key={l}><p className="text-xs text-muted-foreground">{l}</p><p>{v}</p></div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <PackingAttachmentUploader
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
            <DialogTitle>Approve Packing Material Record</DialogTitle>
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
            <DialogTitle>Soft Delete Packing Material Record</DialogTitle>
            <DialogDescription>Change reason and electronic signature required (Part 11 / ALCOA+).</DialogDescription>
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
        moduleName="Packing Material Monitoring"
        recordId={record.id}
        documentNumber={record.packingMaterialMonitoringId}
        actionType={esignAction === 'delete' ? 'Soft Delete' : 'Approve'}
        onSuccess={() => {
          if (esignAction === 'delete') void applyDelete();
          else void applyApprove();
        }}
        onCancel={() => setEsignOpen(false)}
      />
    </div>
  );
}
