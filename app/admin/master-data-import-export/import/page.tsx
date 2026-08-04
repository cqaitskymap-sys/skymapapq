'use client';

import { MasterDataImpexAccessGuard } from '@/components/admin/master-data-import-export/master-data-impex-access-guard';
import { MasterDataImportWizardPage } from '@/components/admin/master-data-import-export/master-data-import-wizard-page';

export default function AdminMasterDataImportWizardRoute() {
  return (
    <MasterDataImpexAccessGuard>
      <MasterDataImportWizardPage />
    </MasterDataImpexAccessGuard>
  );
}
