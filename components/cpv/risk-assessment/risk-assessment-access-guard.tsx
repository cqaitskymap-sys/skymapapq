'use client';

import { cpvPermissions } from '@/lib/cpv';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function RiskAssessmentAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={cpvPermissions.canViewRiskAssessment} moduleLabel="the CPV Risk Assessment Worksheet">
      {children}
    </CpvModuleAccessGuard>
  );
}
