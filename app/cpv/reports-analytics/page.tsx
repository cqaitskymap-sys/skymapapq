import { Suspense } from 'react';
import { ReportsAnalyticsAccessGuard } from '@/components/cpv/reports-analytics/reports-analytics-access-guard';
import { ReportsAnalyticsPage } from '@/components/cpv/reports-analytics/reports-analytics-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function ReportsAnalyticsRoutePage() {
  return (
    <ReportsAnalyticsAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <ReportsAnalyticsPage />
      </Suspense>
    </ReportsAnalyticsAccessGuard>
  );
}
