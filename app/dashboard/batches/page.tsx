'use client';

import { ManufacturingAccessGuard } from '@/components/manufacturing/manufacturing-access-guard';
import { BatchesListPage } from '@/components/admin/batches/batches-list-page';

export default function ManufacturingBatchesPage() {
  return (
    <ManufacturingAccessGuard require="batches">
      <BatchesListPage
        title="Batch Management"
        description="Manufacturing batch records and release documentation"
        basePath="/manufacturing/dashboard"
        sectionLabel="Manufacturing"
      />
    </ManufacturingAccessGuard>
  );
}
