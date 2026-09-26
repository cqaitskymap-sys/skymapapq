'use client';

import { cpvPermissions } from '@/lib/cpv';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function HoldTimeAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={cpvPermissions.canViewHoldTime} moduleLabel="Hold Time Monitoring">
      {children}
    </CpvModuleAccessGuard>
  );
}
