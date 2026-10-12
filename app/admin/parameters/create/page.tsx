'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ParameterAccessGuard } from '@/components/admin/parameters/parameter-access-guard';
import { ParameterForm } from '@/components/admin/parameters/parameter-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canCreateParameters } from '@/lib/permissions';
import { createParameter } from '@/lib/admin/parameter-service';
import { fetchProducts } from '@/lib/admin/product-service';
import type { AdminProduct, ParameterFormData } from '@/lib/admin/schemas';

function CreateParameterContent() {
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

  if (!canCreateParameters(role)) {
    return <ErrorCard accessDenied message="You do not have permission to create parameters." />;
  }

  if (loading) return <LoadingSkeleton rows={1} />;

  const onSubmit = async (data: ParameterFormData) => {
    setSubmitting(true);
    const result = await createParameter(data, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Parameter created');
    router.push(`/admin/parameters/${result.parameter?.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Create Parameter" description="Add a check that production or quality will record, such as temperature, pH, or assay." basePath="/admin" />
      <ParameterForm products={products} onSubmit={onSubmit} onCancel={() => router.push('/admin/parameters')} submitting={submitting} />
    </div>
  );
}

export default function CreateParameterPage() {
  return (
    <ParameterAccessGuard>
      <CreateParameterContent />
    </ParameterAccessGuard>
  );
}
