'use client';

import { MasterDataImpexAccessGuard } from '@/components/admin/master-data-import-export/master-data-impex-access-guard';
import { MasterDataImpexDashboardPage } from '@/components/admin/master-data-import-export/master-data-impex-dashboard-page';

export default function AdminMasterDataImpexPage() {
  return (
    <MasterDataImpexAccessGuard>
      <MasterDataImpexDashboardPage />
    </MasterDataImpexAccessGuard>
  );
}
