import { Suspense } from 'react';
import { SpcAccessGuard } from '@/components/cpv/statistical-process-control/spc-access-guard';
import { SpcPage } from '@/components/cpv/statistical-process-control/spc-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function StatisticalProcessControlRoutePage() {
  return (
    <SpcAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <SpcPage />
      </Suspense>
    </SpcAccessGuard>
  );
}
