import { Suspense } from 'react';
import { CppAccessGuard } from '@/components/cpv/cpp-monitoring/cpp-access-guard';
import { CppMonitoringPage } from '@/components/cpv/cpp-monitoring/cpp-monitoring-page';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';

export const dynamic = 'force-dynamic';

export default function CpvCppRoutePage() {
  return (
    <CppAccessGuard>
      <Suspense fallback={<div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>}>
        <CppMonitoringPage />
      </Suspense>
    </CppAccessGuard>
  );
}
