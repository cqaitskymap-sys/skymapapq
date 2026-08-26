'use client';

import { ManufacturingAccessGuard } from '@/components/manufacturing/manufacturing-access-guard';
import { ProductsListPage } from '@/components/admin/products/products-list-page';

export default function ManufacturingProductsPage() {
  return (
    <ManufacturingAccessGuard require="products">
      <ProductsListPage
        title="Product Master"
        description="Product catalog used across manufacturing, CPV, and PQR"
        basePath="/manufacturing/dashboard"
        sectionLabel="Manufacturing"
      />
    </ManufacturingAccessGuard>
  );
}
