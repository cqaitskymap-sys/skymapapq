import { Suspense } from 'react';
import { CreateAnnualPqrPage } from '@/components/pqr/create/create-annual-pqr-page';
import { RouteLoadingFallback } from '@/components/loading/route-fallback';

export default function CreatePqrRoutePage() {
  return (
    <Suspense fallback={<RouteLoadingFallback variant="form" />}>
      <CreateAnnualPqrPage />
    </Suspense>
  );
}
