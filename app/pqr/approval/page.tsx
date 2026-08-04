import { Suspense } from 'react';
import { PqrApprovalPage } from '@/components/pqr/pqr-approval-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export default function Page() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div>}>
      <PqrApprovalPage />
    </Suspense>
  );
}
