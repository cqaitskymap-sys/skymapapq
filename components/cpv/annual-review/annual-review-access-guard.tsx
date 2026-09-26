'use client';

import { cpvPermissions } from '@/lib/cpv';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function AnnualReviewAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={cpvPermissions.canViewAnnualReview} moduleLabel="Annual CPV Review">
      {children}
    </CpvModuleAccessGuard>
  );
}
