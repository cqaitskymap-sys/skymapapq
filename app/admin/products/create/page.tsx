'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ProductAccessGuard } from '@/components/admin/products/product-access-guard';
import { ProductForm } from '@/components/admin/products/product-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditProducts } from '@/lib/permissions';
import { createProduct } from '@/lib/admin/product-service';
import type { ProductFormData } from '@/lib/admin/schemas';

function CreateProductContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [submitting, setSubmitting] = useState(false);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  if (!canEditProducts(role)) {
    return <ErrorCard accessDenied message="You do not have permission to create products." />;
  }

  const onSubmit = async (data: ProductFormData) => {
    setSubmitting(true);
    try {
      const result = await createProduct(data, auditMeta);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success('Product created');
      router.push(`/admin/products/${result.product?.id}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Create Product" description="Add a new pharmaceutical product master record" />
      <ProductForm onSubmit={onSubmit} onCancel={() => router.push('/admin/products')} submitting={submitting} />
    </div>
  );
}

export default function CreateProductPage() {
  return (
    <ProductAccessGuard>
      <CreateProductContent />
    </ProductAccessGuard>
  );
}
