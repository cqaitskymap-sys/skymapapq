import { Suspense } from 'react';
import { PackingAccessGuard } from '@/components/cpv/packing-material-monitoring/packing-access-guard';
import { PackingMonitoringPage } from '@/components/cpv/packing-material-monitoring/packing-monitoring-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function PackingMaterialMonitoringRoutePage() {
  return (
    <PackingAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <PackingMonitoringPage />
      </Suspense>
    </PackingAccessGuard>
  );
}
