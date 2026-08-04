'use client';

import { MasterDataImpexAccessGuard } from '@/components/admin/master-data-import-export/master-data-impex-access-guard';
import { MasterDataImpexHistoryPage } from '@/components/admin/master-data-import-export/master-data-impex-history-page';

export default function AdminMasterDataImpexHistoryRoute() {
  return (
    <MasterDataImpexAccessGuard>
      <MasterDataImpexHistoryPage />
    </MasterDataImpexAccessGuard>
  );
}
