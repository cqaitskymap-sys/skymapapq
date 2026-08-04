'use client';

import { EsignSettingsAccessGuard } from '@/components/admin/esign-settings/esign-settings-access-guard';
import { EsignHistoryPage } from '@/components/admin/esign-settings/esign-history-page';

export default function AdminEsignHistoryRoute() {
  return (
    <EsignSettingsAccessGuard>
      <EsignHistoryPage />
    </EsignSettingsAccessGuard>
  );
}
