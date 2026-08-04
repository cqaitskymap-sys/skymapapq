import { Suspense } from 'react';
import { TrendAnalysisAccessGuard } from '@/components/cpv/trend-analysis/trend-analysis-access-guard';
import { TrendAnalysisPage } from '@/components/cpv/trend-analysis/trend-analysis-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function TrendAnalysisRoutePage() {
  return (
    <TrendAnalysisAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <TrendAnalysisPage />
      </Suspense>
    </TrendAnalysisAccessGuard>
  );
}
