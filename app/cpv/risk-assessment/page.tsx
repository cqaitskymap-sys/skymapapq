import { Suspense } from 'react';
import { RiskAssessmentAccessGuard } from '@/components/cpv/risk-assessment/risk-assessment-access-guard';
import { RiskAssessmentPage } from '@/components/cpv/risk-assessment/risk-assessment-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function RiskAssessmentRoutePage() {
  return (
    <RiskAssessmentAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <RiskAssessmentPage />
      </Suspense>
    </RiskAssessmentAccessGuard>
  );
}
