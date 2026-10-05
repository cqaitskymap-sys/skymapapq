'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Lock, Download, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { BatchStatusBadge } from './batch-status-badge';
import { ReleaseStatusBadge } from './release-status-badge';
import { BatchLifecycleTimeline } from './batch-lifecycle-badge';
import { BatchAttachmentsSection } from './batch-attachments-section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditBatches, canQaOverrideBatch } from '@/lib/permissions';
import type { AdminBatch, BatchAttachment } from '@/lib/admin/schemas';
import {
  fetchBatchById, fetchBatchAttachments, fetchBatchAuditTrail, isBatchReleasedLocked,
  exportBatchesCsv, countLinkedIntegrations,
} from '@/lib/admin/batch-service';

export function BatchDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditBatches(role);
  const canOverride = canQaOverrideBatch(role);

  const [batch, setBatch] = useState<AdminBatch | null>(null);
  const [attachments, setAttachments] = useState<BatchAttachment[]>([]);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [linkedCount, setLinkedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  const load = useCallback(async () => {
    try {
      const b = await fetchBatchById(id, true);
      if (!b) {
        setError('Batch not found');
        return;
      }
      setBatch(b);
      setAttachments(await fetchBatchAttachments(id));
      setAuditTrail(await fetchBatchAuditTrail(id));
      setLinkedCount(await countLinkedIntegrations(id, b.batchNumber));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !batch) return <ErrorCard title="Not Found" message={error || 'Batch not found'} />;

  const releasedLocked = isBatchReleasedLocked(batch);
  const showEdit = canEdit && (!releasedLocked || canOverride);

  const overviewFields = [
    { label: 'Batch ID', value: batch.batchId },
    { label: 'Product Code', value: batch.productCode },
    { label: 'Product Name', value: batch.productName },
    { label: 'Product Version', value: batch.productVersion },
    { label: 'Product Category', value: batch.productCategory },
    { label: 'Generic Name', value: batch.genericName },
    { label: 'Strength', value: batch.strength },
    { label: 'Dosage Form', value: batch.dosageForm },
    { label: 'Market', value: batch.market },
    { label: 'Batch Size', value: `${batch.batchSize} ${batch.batchSizeUnit || batch.unit || ''}` },
    { label: 'Planned Quantity', value: batch.plannedQuantity },
    { label: 'Actual Quantity', value: batch.actualQuantity },
    { label: 'Manufacturing Date', value: batch.manufacturingDate },
    { label: 'Packaging Date', value: batch.packagingDate },
    { label: 'Expiry Date', value: batch.expiryDate },
    { label: 'Retest Date', value: batch.retestDate },
    { label: 'Shelf Life', value: batch.shelfLife },
    { label: 'Batch Prefix', value: batch.batchPrefix },
    { label: 'Manufacturing Site', value: batch.manufacturingSite },
    { label: 'Business Unit', value: batch.businessUnit },
    { label: 'Department', value: batch.department },
    { label: 'Warehouse', value: batch.warehouse },
    { label: 'Storage Location', value: batch.storageLocation },
    { label: 'Manufacturing Line', value: batch.manufacturingLine || batch.lineNumber },
    { label: 'Equipment', value: batch.equipment },
    { label: 'Process Version', value: batch.processVersion },
    { label: 'Recipe Version', value: batch.recipeVersion },
    { label: 'Shift', value: batch.shift },
    { label: 'MFR / BMR / BPR', value: `${batch.mfrNumber || '-'} / ${batch.bmrNumber || '-'} / ${batch.bprNumber || '-'}` },
    { label: 'Manufactured For', value: batch.manufacturedFor },
    { label: 'Customer', value: batch.customerName },
    { label: 'QC Status', value: batch.qcStatus },
    { label: 'QA Status', value: batch.qaStatus },
    { label: 'Release Date', value: batch.releaseDate },
    { label: 'QA Released By', value: batch.qaReleasedBy },
    { label: 'Created By', value: batch.createdBy },
    { label: 'Created At', value: batch.createdAt },
    { label: 'Updated By', value: batch.updatedBy },
    { label: 'Updated At', value: batch.updatedAt },
  ];

  const handleExport = () => {
    const csv = exportBatchesCsv([batch]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch-${batch.batchNumber}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Batch exported');
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/batches')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Batches
      </Button>

      <PageHeader
        title={batch.batchNumber}
        description={`${batch.productName} · ${batch.batchId || batch.productCode}`}
        basePath="/admin"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {showEdit && (
              <Button asChild className="bg-blue-600 hover:bg-blue-700">
                <Link href={`/admin/batches/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit Batch</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <BatchStatusBadge status={batch.batchStatus} />
        <ReleaseStatusBadge status={batch.releaseStatus} />
        {batch.isDeleted && <Badge variant="destructive">Deleted</Badge>}
        {batch.isArchived && <Badge variant="secondary">Archived</Badge>}
        {releasedLocked && (
          <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200 dark:bg-amber-950 dark:text-amber-200">
            <Lock className="h-3 w-3" />
            Released — critical fields locked
          </span>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Batch Profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {overviewFields.map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium">{String(f.value ?? '-')}</p>
                </div>
              ))}
              {batch.statusChangeReason && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Status Change Reason</p>
                  <p className="font-medium">{batch.statusChangeReason}</p>
                </div>
              )}
              {batch.remarks && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p className="font-medium">{batch.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Additional Batch Numbers</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              {[
                { label: 'Semi Finished', value: batch.semiFinishedBatchNumber },
                { label: 'Finished Product', value: batch.finishedProductBatchNumber },
                { label: 'Packing Batch', value: batch.packingBatchNumber },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium">{f.value || '-'}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <BatchAttachmentsSection
            batchId={id}
            attachments={attachments}
            canUpload={canEdit && !batch.isDeleted}
            auditMeta={auditMeta}
            onRefresh={load}
          />
        </TabsContent>

        <TabsContent value="lifecycle">
          <Card>
            <CardHeader><CardTitle className="text-base">Status Timeline</CardTitle></CardHeader>
            <CardContent>
              <BatchLifecycleTimeline currentStatus={batch.batchStatus} auditTrail={auditTrail} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4" />Module Integrations</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Linked records across SkyMap QMS modules: <strong>{linkedCount}</strong></p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Link href={`/admin/products?search=${batch.productCode}`} className="text-blue-600 hover:underline">Product Master → {batch.productCode}</Link>
                <Link href={`/cpv/batch-registration?batch=${batch.batchNumber}`} className="text-blue-600 hover:underline">CPV Batch Registration</Link>
                <Link href="/pqr/batch-review" className="text-blue-600 hover:underline">PQR Batch Review</Link>
                <Link href="/qms/deviation" className="text-blue-600 hover:underline">Deviation Management</Link>
                <Link href="/qms/oos" className="text-blue-600 hover:underline">OOS Investigation</Link>
                <Link href="/qms/capa" className="text-blue-600 hover:underline">CAPA Management</Link>
              </div>
              {linkedCount > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                  This batch has {linkedCount} linked record(s). Deletion is blocked until references are resolved.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardHeader><CardTitle className="text-base">Batch Reports</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>Export batch master record for PQR, APQR, CPV, and regulatory submissions.</p>
              <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Download CSV Report</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-base">Audit Trail (Immutable)</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState title="No audit entries" />
              ) : (
                <div className="space-y-2">
                  {auditTrail.map((entry, i) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-1 p-2 border rounded text-sm">
                      <span className="font-medium">{String(entry.action ?? '-')}</span>
                      <span className="text-xs text-muted-foreground flex-1">
                        {String(entry.userName ?? entry.actorName ?? '-')} · {String(entry.timestamp ?? entry.dateTime ?? '-')}
                      </span>
                      {entry.reason != null && entry.reason !== '' && (
                        <span className="text-xs">{String(entry.reason)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle className="text-base">Batch History</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.filter((e) => ['EDIT_BATCH', 'STATUS_CHANGE', 'QA_OVERRIDE'].includes(String(e.action))).length === 0 ? (
                <EmptyState title="No history entries" />
              ) : (
                <div className="space-y-2">
                  {auditTrail
                    .filter((e) => ['EDIT_BATCH', 'STATUS_CHANGE', 'QA_OVERRIDE', 'CREATE_BATCH'].includes(String(e.action)))
                    .map((entry, i) => (
                      <div key={i} className="p-2 border rounded text-sm">
                        <p className="font-medium">{String(entry.action)}</p>
                        <p className="text-xs text-muted-foreground">
                          {String(entry.userName ?? '-')} · {String(entry.timestamp ?? entry.dateTime ?? '-')}
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
