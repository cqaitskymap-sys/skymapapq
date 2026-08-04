import { Suspense } from 'react';
import { CqaAccessGuard } from '@/components/cpv/cqa-monitoring/cqa-access-guard';
import { CqaMonitoringPage } from '@/components/cpv/cqa-monitoring/cqa-monitoring-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function CpvCqaRoutePage() {
  return (
    <CqaAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <CqaMonitoringPage />
      </Suspense>
    </CqaAccessGuard>
  );
}
