'use client';

import { cpvPermissions } from '@/lib/cpv';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function ProcessCapabilityAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={cpvPermissions.canViewProcessCapability} moduleLabel="Process Capability">
      {children}
    </CpvModuleAccessGuard>
  );
}
