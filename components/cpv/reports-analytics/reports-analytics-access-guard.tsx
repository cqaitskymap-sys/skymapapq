'use client';

import { cpvPermissions } from '@/lib/cpv';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function ReportsAnalyticsAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={cpvPermissions.canViewReportsAnalytics} moduleLabel="CPV Reports & Analytics">
      {children}
    </CpvModuleAccessGuard>
  );
}
