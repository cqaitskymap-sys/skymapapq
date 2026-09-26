'use client';

import { canViewEquipmentReview } from '@/lib/pqr-equipment-review-records';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function EquipmentReviewAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={canViewEquipmentReview} moduleLabel="Equipment Review">
      {children}
    </CpvModuleAccessGuard>
  );
}
