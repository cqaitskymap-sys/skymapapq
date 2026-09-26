'use client';

import { cpvPermissions } from '@/lib/cpv';
import { CpvModuleAccessGuard } from '@/components/cpv/cpv-module-access-guard';

export function SpcAccessGuard({ children }: { children: React.ReactNode }) {
  return (
    <CpvModuleAccessGuard canView={cpvPermissions.canViewSpc} moduleLabel="Statistical Process Control">
      {children}
    </CpvModuleAccessGuard>
  );
}
