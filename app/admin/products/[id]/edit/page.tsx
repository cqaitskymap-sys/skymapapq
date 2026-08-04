'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ProductAccessGuard } from '@/components/admin/products/product-access-guard';
import { ProductForm } from '@/components/admin/products/product-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditProducts } from '@/lib/permissions';
import {
  fetchProductById, fetchProductCompositions, fetchProductPacking, updateProduct,
} from '@/lib/admin/product-service';
import type { ProductFormData } from '@/lib/admin/schemas';

function EditProductContent({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [initial, setInitial] = useState<ProductFormData | null>(null);
  const [existing, setExisting] = useState<Awaited<ReturnType<typeof fetchProductById>>>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  useEffect(() => {
    fetchProductById(id, true).then(async (p) => {
      if (!p) {
        setLoading(false);
        return;
      }
      const [comps, pack] = await Promise.all([
        fetchProductCompositions(id),
        fetchProductPacking(id),
      ]);
      setExisting(p);
      setInitial({
        productCode: p.productCode,
        productName: p.productName,
        genericName: p.genericName || '',
        brandName: p.brandName || '',
        productFamily: p.productFamily || '',
        category: (p.category as ProductFormData['category']) || '',
        strength: p.strength || '',
        dosageForm: (p.dosageForm as ProductFormData['dosageForm']) || 'Other',
        routeOfAdministration: p.routeOfAdministration || '',
        packSize: p.packSize || '',
        packType: (p.packType as ProductFormData['packType']) || '',
        containerClosure: (p.containerClosure as ProductFormData['containerClosure']) || '',
        market: (p.market as ProductFormData['market']) || 'Domestic',
        country: p.country || 'India',
        manufacturingSite: p.manufacturingSite || '',
        businessUnit: p.businessUnit || '',
        department: p.department || '',
        productOwner: p.productOwner || '',
        lifecycleStatus: (p.lifecycleStatus as ProductFormData['lifecycleStatus']) || 'Commercial',
        therapeuticCategory: p.therapeuticCategory || '',
        shelfLife: p.shelfLife || '',
        storageCondition: p.storageCondition || '',
        standardBatchSize: p.standardBatchSize || p.batchSize || '',
        manufacturingLicenseNumber: p.manufacturingLicenseNumber || p.manufacturingLicenseNo || '',
        registrationNumber: p.registrationNumber || '',
        licenseNumber: p.licenseNumber || '',
        mfrNumber: p.mfrNumber || '',
        bmrNumber: p.bmrNumber || '',
        bprNumber: p.bprNumber || '',
        specificationNumber: p.specificationNumber || '',
        stpNumber: p.stpNumber || '',
        batchPrefix: p.batchPrefix || '',
        hsnCode: p.hsnCode || '',
        gtin: p.gtin || '',
        barcode: p.barcode || '',
        qrCode: p.qrCode || '',
        productStatus: (p.productStatus as ProductFormData['productStatus']) || 'Active',
        description: p.description || '',
        remarks: p.remarks || '',
        compositions: comps.length ? comps : [{
          ingredientName: 'API', ingredientType: 'API', grade: '', quantity: 1, unit: 'mg',
          functionPurpose: '', specificationNo: '', stpNo: '',
        }],
        packingDetails: pack,
        changeReason: '',
      });
      setLoading(false);
    });
  }, [id]);

  if (!canEditProducts(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit products." />;
  }

  if (loading) return <LoadingSkeleton rows={1} />;
  if (!initial || !existing) return <ErrorCard title="Not Found" message="Product not found" />;

  const onSubmit = async (data: ProductFormData) => {
    setSubmitting(true);
    const result = await updateProduct(id, data, existing, auditMeta);
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.cascadeCount && result.cascadeCount > 0) {
      toast.success(`Product updated — ${result.cascadeCount} linked batch record(s) synchronized`);
    } else {
      toast.success('Product updated');
    }
    router.push(`/admin/products/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Product" description={existing.productName} basePath="/admin" />
      <ProductForm
        initial={initial}
        onSubmit={onSubmit}
        onCancel={() => router.push(`/admin/products/${id}`)}
        submitting={submitting}
      />
    </div>
  );
}

export default function EditProductPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <ProductAccessGuard>
      <EditProductContent id={params.id} />
    </ProductAccessGuard>
  );
}
