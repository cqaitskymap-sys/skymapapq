import { Suspense } from 'react';
import { MaterialReviewPage } from '@/components/pqr/material-review-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div>}>
      <MaterialReviewPage />
    </Suspense>
  );
}
