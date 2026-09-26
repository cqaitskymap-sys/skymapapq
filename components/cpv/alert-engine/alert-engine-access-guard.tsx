'use client';

import { cpvPermissions } from '@/lib/cpv';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function AlertEngineAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={cpvPermissions.canViewAlerts} moduleLabel="the CPV Alert Engine">
      {children}
    </CpvModuleAccessGuard>
  );
}
