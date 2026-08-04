import { Suspense } from 'react';
import { UtilityAccessGuard } from '@/components/cpv/utility-monitoring/utility-access-guard';
import { UtilityMonitoringPage } from '@/components/cpv/utility-monitoring/utility-monitoring-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function UtilityMonitoringRoutePage() {
  return (
    <UtilityAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <UtilityMonitoringPage />
      </Suspense>
    </UtilityAccessGuard>
  );
}
