'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BatchAccessGuard } from '@/components/admin/batches/batch-access-guard';
import { BatchForm } from '@/components/admin/batches/batch-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canProductionCreateBatches } from '@/lib/permissions';
import { createBatch } from '@/lib/admin/batch-service';
import { fetchProducts } from '@/lib/admin/product-service';
import type { AdminProduct, BatchFormData } from '@/lib/admin/schemas';

function CreateBatchContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchProducts().then((p) => {
      setProducts(p);
      setLoading(false);
    });
  }, []);

  if (!canProductionCreateBatches(role)) {
    return <ErrorCard accessDenied message="You do not have permission to create batches." />;
  }

  if (loading) return <LoadingSkeleton rows={1} />;

  const onSubmit = async (data: BatchFormData) => {
    setSubmitting(true);
    const result = await createBatch(data, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Batch created');
    router.push(`/admin/batches/${result.batch?.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Create Batch" description="Register a new manufacturing batch linked to Product Master" basePath="/admin" />
      <BatchForm products={products} isCreate onSubmit={onSubmit} onCancel={() => router.push('/admin/batches')} submitting={submitting} />
    </div>
  );
}

export default function CreateBatchPage() {
  return (
    <BatchAccessGuard>
      <CreateBatchContent />
    </BatchAccessGuard>
  );
}
