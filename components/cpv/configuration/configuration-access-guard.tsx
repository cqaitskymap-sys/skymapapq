'use client';

import { canViewCpvConfiguration } from '@/lib/cpv-configuration-records';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function ConfigurationAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={canViewCpvConfiguration} moduleLabel="CPV Configuration">
      {children}
    </CpvModuleAccessGuard>
  );
}
