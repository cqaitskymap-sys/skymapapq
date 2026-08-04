import { Suspense } from 'react';
import { AnnualReviewAccessGuard } from '@/components/cpv/annual-review/annual-review-access-guard';
import { AnnualReviewPage } from '@/components/cpv/annual-review/annual-review-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function AnnualReviewRoutePage() {
  return (
    <AnnualReviewAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <AnnualReviewPage />
      </Suspense>
    </AnnualReviewAccessGuard>
  );
}
