'use client';

import { ModuleConfigurationAccessGuard } from '@/components/admin/module-configuration/module-configuration-access-guard';
import { ModuleConfigurationListPage } from '@/components/admin/module-configuration/module-configuration-list-page';

export default function AdminModuleConfigurationPage() {
  return (
    <ModuleConfigurationAccessGuard>
      <ModuleConfigurationListPage />
    </ModuleConfigurationAccessGuard>
  );
}
