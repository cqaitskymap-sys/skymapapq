'use client';

import { cpvPermissions } from '@/lib/cpv';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function TrendAnalysisAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={cpvPermissions.canViewTrendAnalysis} moduleLabel="Trend Analysis">
      {children}
    </CpvModuleAccessGuard>
  );
}
