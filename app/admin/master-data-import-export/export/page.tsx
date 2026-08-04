'use client';

import { MasterDataImpexAccessGuard } from '@/components/admin/master-data-import-export/master-data-impex-access-guard';
import { MasterDataExportWizardPage } from '@/components/admin/master-data-import-export/master-data-export-wizard-page';

export default function AdminMasterDataExportWizardRoute() {
  return (
    <MasterDataImpexAccessGuard>
      <MasterDataExportWizardPage />
    </MasterDataImpexAccessGuard>
  );
}
