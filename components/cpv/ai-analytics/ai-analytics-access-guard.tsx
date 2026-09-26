'use client';

import { canViewAiAnalytics } from '@/lib/cpv-ai-analytics-records';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function AiAnalyticsAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={canViewAiAnalytics} moduleLabel="CPV AI Analytics">
      {children}
    </CpvModuleAccessGuard>
  );
}
