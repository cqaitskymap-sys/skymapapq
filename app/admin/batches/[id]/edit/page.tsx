'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BatchAccessGuard } from '@/components/admin/batches/batch-access-guard';
import { BatchForm } from '@/components/admin/batches/batch-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditBatches, canQaOverrideBatch } from '@/lib/permissions';
import {
  fetchBatchById, updateBatch, isBatchReleasedLocked,
} from '@/lib/admin/batch-service';
import { fetchProducts } from '@/lib/admin/product-service';
import type { AdminBatch, AdminProduct, BatchFormData } from '@/lib/admin/schemas';

function EditBatchContent({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [initial, setInitial] = useState<BatchFormData | null>(null);
  const [existing, setExisting] = useState<AdminBatch | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<BatchFormData | null>(null);

  useEffect(() => {
    Promise.all([fetchBatchById(id), fetchProducts()]).then(([b, p]) => {
      if (!b) {
        setLoading(false);
        return;
      }
      setExisting(b);
      setProducts(p);
      setInitial({
        productCode: b.productCode,
        batchNumber: b.batchNumber,
        batchCode: b.batchCode || '',
        productName: b.productName || '',
        productVersion: b.productVersion || '',
        productCategory: b.productCategory || '',
        genericName: b.genericName || '',
        strength: b.strength || '',
        dosageForm: b.dosageForm || '',
        market: b.market || '',
        manufacturingOrder: b.manufacturingOrder || '',
        batchSize: Number(b.batchSize) || 0,
        batchSizeUnit: (b.batchSizeUnit || b.unit || 'Vials') as BatchFormData['batchSizeUnit'],
        plannedQuantity: b.plannedQuantity ? Number(b.plannedQuantity) : undefined,
        actualQuantity: b.actualQuantity ? Number(b.actualQuantity) : undefined,
        manufacturingDate: b.manufacturingDate || '',
        packagingDate: b.packagingDate || '',
        expiryDate: b.expiryDate || '',
        retestDate: b.retestDate || '',
        shelfLife: b.shelfLife || '',
        batchPrefix: b.batchPrefix || '',
        manufacturingSite: b.manufacturingSite || '',
        businessUnit: b.businessUnit || '',
        department: b.department || '',
        warehouse: b.warehouse || '',
        storageLocation: b.storageLocation || '',
        manufacturingLine: b.manufacturingLine || b.lineNumber || '',
        equipment: b.equipment || '',
        processVersion: b.processVersion || '',
        recipeVersion: b.recipeVersion || '',
        shift: b.shift || '',
        mfrNumber: b.mfrNumber || '',
        bmrNumber: b.bmrNumber || '',
        bprNumber: b.bprNumber || '',
        manufacturedFor: b.manufacturedFor || '',
        customerName: b.customerName || '',
        batchStatus: (b.batchStatus as BatchFormData['batchStatus']) || 'Planned',
        releaseStatus: (b.releaseStatus as BatchFormData['releaseStatus']) || 'Pending',
        qcStatus: (b.qcStatus as BatchFormData['qcStatus']) || 'Pending',
        qaStatus: (b.qaStatus as BatchFormData['qaStatus']) || 'Pending',
        releaseDate: b.releaseDate || '',
        qaReleasedBy: b.qaReleasedBy || '',
        semiFinishedBatchNumber: b.semiFinishedBatchNumber || '',
        finishedProductBatchNumber: b.finishedProductBatchNumber || '',
        packingBatchNumber: b.packingBatchNumber || '',
        statusChangeReason: b.statusChangeReason || '',
        remarks: b.remarks || '',
        changeReason: '',
        qaOverride: false,
      });
      setLoading(false);
    });
  }, [id]);

  if (!canEditBatches(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit batches." />;
  }

  if (loading) return <LoadingSkeleton rows={1} />;
  if (!initial || !existing) return <ErrorCard title="Not Found" message="Batch not found" />;

  const releasedLocked = isBatchReleasedLocked(existing);
  const canOverride = canQaOverrideBatch(role);

  if (releasedLocked && !canOverride) {
    return <ErrorCard accessDenied message="Released batch cannot be edited without QA override permission." />;
  }

  const confirmSave = async (data: BatchFormData) => {
    if (data.changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setSubmitting(true);
    const result = await updateBatch(id, data, existing, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    }, role);
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Batch updated');
    router.push(`/admin/batches/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Batch" description={existing.batchNumber} basePath="/admin" />
      <BatchForm
        initial={initial}
        products={products}
        releasedLocked={releasedLocked}
        canQaOverride={canOverride}
        onSubmit={(data) => setPending(data)}
        onCancel={() => router.push(`/admin/batches/${id}`)}
        submitting={submitting}
      />
      <AlertDialog open={!!pending} onOpenChange={() => setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
            <AlertDialogDescription>Save changes to batch &quot;{pending?.batchNumber}&quot;?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-blue-600" onClick={() => pending && confirmSave(pending)}>Save Changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function EditBatchPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <BatchAccessGuard>
      <EditBatchContent id={params.id} />
    </BatchAccessGuard>
  );
}
