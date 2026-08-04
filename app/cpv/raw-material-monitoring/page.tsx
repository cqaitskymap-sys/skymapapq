import { Suspense } from 'react';
import { RawMaterialAccessGuard } from '@/components/cpv/raw-material-monitoring/raw-material-access-guard';
import { RawMaterialMonitoringPage } from '@/components/cpv/raw-material-monitoring/raw-material-monitoring-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function RawMaterialMonitoringRoutePage() {
  return (
    <RawMaterialAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <RawMaterialMonitoringPage />
      </Suspense>
    </RawMaterialAccessGuard>
  );
}
