import { Suspense } from 'react';
import { CpvBatchAccessGuard } from '@/components/cpv/batch-registration/cpv-batch-access-guard';
import { CpvBatchListPage } from '@/components/cpv/batch-registration/cpv-batch-list-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export default function CpvBatchRegistrationRoutePage() {
  return (
    <CpvBatchAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <CpvBatchListPage />
      </Suspense>
    </CpvBatchAccessGuard>
  );
}
