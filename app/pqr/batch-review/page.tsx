import { Suspense } from 'react';
import { BatchReviewPage } from '@/components/pqr/batch-review/batch-review-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div>}>
      <BatchReviewPage />
    </Suspense>
  );
}
